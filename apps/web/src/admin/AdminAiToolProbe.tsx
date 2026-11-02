import { useEffect, useRef, useState } from 'react';
import {
  AI_TOOL_LABELS,
  type AiToolId,
  type AiToolActivity,
  type AiImageGenerationJob,
  type AiWebSearchEvidence,
} from '@asa-lab/contracts';
import { AiStreamClientError, streamAiRequest } from '../ai/stream-ai-request';
import { AiWebEvidence } from '../ai/AiWebEvidence';
import { AiGeneratedImage } from '../ai/AiGeneratedImage';
import { InfoHint } from '../components/InfoHint';
import { newClientId } from '../client-id';
import { call } from './admin-api';
import type { ToolPolicy } from './AdminAiToolPolicies';

interface Message {
  requestId: string;
  role: string;
  content: string;
  state?: string;
  webSearch?: AiWebSearchEvidence;
}
interface FileResult {
  name: string;
  version: number;
  content?: string;
}
interface Operation {
  thread: string;
  request: string;
  tool: AiToolId;
}
interface ProbeResult {
  tool: AiToolId;
  verdict: string;
  text: string;
  evidence?: AiWebSearchEvidence;
  file?: FileResult;
  job?: AiImageGenerationJob;
}
interface ModelStatus {
  enabled: boolean;
  canGenerate?: boolean;
  model: string;
  modelChoices?: readonly { id: string; label: string }[];
}
const examples: Record<AiToolId, string> = {
  web_search: 'Найди официальный сайт Московского планетария и укажи источник.',
  read_page: 'Прочитай https://example.org и кратко опиши содержимое.',
  image_search: 'Найди фотографии рыжих кошек.',
  weather: 'Какая сейчас погода в Москве, Россия?',
  generate_image: 'Нарисуй маленький деревянный дом в сосновом лесу.',
  create_working_file: 'Создай файл с текстом «Проверка ASA Lab».',
  read_working_file: 'Прочитай содержимое файла.',
  edit_working_file: 'Замени «Проверка ASA Lab» на «Инструмент редактирования работает».',
};
const isFile = (tool: AiToolId) => tool.endsWith('working_file');
const terminalImage = (job: AiImageGenerationJob) =>
  ['complete', 'failed', 'cancelled'].includes(job.state);
const imageVerdict = (job: AiImageGenerationJob) =>
  job.state === 'complete' && job.image
    ? 'Изображение получено.'
    : job.state === 'failed'
      ? 'Генерация не удалась. Проверьте подключение генератора.'
      : job.state === 'cancelled'
        ? 'Генерация отменена.'
        : job.state === 'unknown'
          ? 'Исход генерации уточняется. Повторный запуск не выполняется.'
          : 'Изображение ещё создаётся…';

/** End-to-end probe: normal owner admission, quotas, model and tool executor. Never a privileged bypass. */
export function AdminAiToolProbe({
  principalId,
  tool,
  rule,
  unsaved,
  onBusyChange,
  onAccessDenied,
}: {
  principalId: string;
  tool: AiToolId;
  rule?: ToolPolicy | undefined;
  unsaved: boolean;
  onBusyChange: (busy: boolean) => void;
  onAccessDenied: () => void;
}) {
  const key = 'asa-ai-tool-probe:v1:' + principalId;
  const [drafts, setDrafts] = useState<Partial<Record<AiToolId, string>>>({});
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [model, setModel] = useState('');
  const [name, setName] = useState('probe.txt');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Operation | null>(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      return value &&
        /^[0-9a-f-]{36}$/i.test(value.thread) &&
        /^[0-9a-f-]{36}$/i.test(value.request) &&
        Object.hasOwn(examples, value.tool)
        ? value
        : null;
    } catch {
      return null;
    }
  });
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [activities, setActivities] = useState<readonly AiToolActivity[]>([]);
  const [error, setError] = useState('');
  const thread = useRef<string>(
    (() => {
      try {
        const saved = sessionStorage.getItem(key + ':thread') ?? '';
        return pending?.thread ?? (/^[0-9a-f-]{36}$/i.test(saved) ? saved : '');
      } catch {
        return pending?.thread ?? '';
      }
    })(),
  );
  const operation = useRef<Operation | null>(pending);
  const controller = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const live = useRef(true);
  const prompt = drafts[tool] ?? examples[tool];
  useEffect(() => {
    live.current = true;
    void call<ModelStatus>('/api/ai/status').then((reply) => {
      if (!live.current) return;
      if (!reply.ok) {
        if (reply.status === 401) onAccessDenied();
        setError('Не удалось получить доступные модели.');
        return;
      }
      if (typeof reply.data.model !== 'string' || typeof reply.data.enabled !== 'boolean') {
        setError('Ответ сервера о моделях несовместим с этой версией.');
        return;
      }
      setStatus(reply.data);
      setModel(reply.data.model);
      if (!reply.data.enabled || reply.data.canGenerate === false)
        setError(
          'Текстовая модель сейчас недоступна для проверки. Проверьте подключения и доступ.',
        );
    });
    return () => {
      live.current = false;
      controller.current?.abort();
    };
  }, [onAccessDenied]);
  useEffect(() => onBusyChange(busy || pending !== null), [busy, pending, onBusyChange]);
  function remember(value: Operation | null) {
    operation.current = value;
    setPending(value);
    try {
      if (value) sessionStorage.setItem(key, JSON.stringify(value));
      else sessionStorage.removeItem(key);
    } catch {
      /* Server still owns the operation and replay rules. */
    }
  }
  async function fileRead(id: string): Promise<FileResult | undefined> {
    if (!isFile(tool)) return;
    const reply = await call<FileResult>(
      '/api/ai/threads/' + encodeURIComponent(id) + '/working-files/' + encodeURIComponent(name),
    );
    return reply.ok ? reply.data : undefined;
  }
  async function run() {
    if (
      locked.current ||
      pending ||
      unsaved ||
      !prompt.trim() ||
      !rule?.enabled ||
      !status?.enabled ||
      status.canGenerate === false
    )
      return;
    if (isFile(tool) && (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(name) || name.includes('..'))) {
      setError('Укажите простое имя файла, например probe.txt.');
      return;
    }
    locked.current = true;
    setBusy(true);
    setError('');
    setResult(null);
    setActivities([]);
    const abort = new AbortController();
    controller.current = abort;
    let attempt: Operation | null = null;
    const trace: AiToolActivity[] = [];
    try {
      const latest = await call<{ tools: ToolPolicy[] }>('/api/admin/v1/ai/tool-policy');
      const admitted =
        latest.ok && Array.isArray(latest.data.tools)
          ? latest.data.tools.find((item) => item.id === tool)
          : undefined;
      if (!admitted?.enabled || !admitted.available) {
        setError(admitted?.reason || 'Инструмент выключен или не настроен.');
        return;
      }
      let size: 768 | 1024 | 1280 | 1536 | 720 | 864 = 1024;
      if (tool === 'generate_image') {
        const images = await call<{ sizes: (typeof size)[] }>('/api/ai/image-generation/status');
        if (!images.ok || !images.data.sizes.length) throw new Error('image_config');
        size = images.data.sizes[0]!;
      }
      if (abort.signal.aborted) return;
      if (!thread.current) {
        const created = await call<{ id: string }>('/api/ai/threads', {
          method: 'POST',
          body: '{}',
        });
        if (!created.ok) {
          setError('Не удалось создать собственный диалог проверки.');
          return;
        }
        thread.current = created.data.id;
        try {
          sessionStorage.setItem(key + ':thread', thread.current);
        } catch {
          /* Optional draft continuity; all reads still authorize the owner. */
        }
        // A named own conversation keeps created files available for subsequent read/edit probes.
        await call('/api/ai/threads/' + encodeURIComponent(thread.current), {
          method: 'PATCH',
          body: JSON.stringify({ title: 'Проверка инструментов' }),
        });
      }
      if (abort.signal.aborted) return;
      const before = await fileRead(thread.current);
      if (abort.signal.aborted) return;
      attempt = { thread: thread.current, request: newClientId(), tool };
      remember(attempt);
      const input =
        'Проверка инструмента ' +
        tool +
        '. Выполни запрос этим инструментом и кратко сообщи фактический результат. Не утверждай успех без вызова.' +
        (isFile(tool)
          ? ' Работай с файлом ' + name + '. При редактировании сначала прочитай текущую версию. '
          : ' ') +
        prompt;
      const reply = await streamAiRequest<Message>(
        attempt.thread,
        input,
        attempt.request,
        (piece) => {
          if (live.current)
            setResult((old) => ({
              tool,
              verdict: 'Модель отвечает…',
              text: (old?.text ?? '') + piece,
            }));
        },
        abort.signal,
        model,
        {},
        [],
        {
          mode:
            tool === 'web_search' || tool === 'read_page'
              ? 'web'
              : tool === 'image_search'
                ? 'images'
                : tool === 'weather'
                  ? 'weather'
                  : 'off',
        },
        { mode: tool === 'generate_image' ? 'auto' : 'off', size },
        (activity) => {
          trace.push(activity);
          if (live.current) setActivities([...trace]);
        },
      );
      if (!live.current || abort.signal.aborted) return;
      const messages = reply.messages.filter(
        (item) => item.requestId === attempt!.request && item.role === 'assistant',
      );
      const evidence = messages.find((item) => item.webSearch)?.webSearch;
      const file = await fileRead(attempt.thread);
      if (!live.current || abort.signal.aborted) return;
      const called = trace.some((item) => item.tool === tool);
      let verdict = called
        ? 'Инструмент вызван. Результат ниже.'
        : 'Модель ответила без подтверждённого вызова выбранного инструмента.';
      if (reply.stopped) verdict = 'Ответ остановлен; успешная проверка не подтверждена.';
      else if (called && evidence)
        verdict =
          evidence.status === 'ready'
            ? tool === 'read_page' && !evidence.sources.some((source) => source.pageRead === 'read')
              ? 'Источник получен, но чтение текста страницы не подтверждено.'
              : 'Данные инструмента получены.'
            : evidence.status === 'empty'
              ? 'Инструмент вернул пустую выдачу.'
              : evidence.status === 'needs_location'
                ? 'Нужно уточнить город или регион.'
                : 'Данные не получены. Проверьте подключение и лимиты.';
      else if (called && isFile(tool))
        verdict =
          file && (tool === 'read_working_file' || file.version > (before?.version ?? 0))
            ? 'Файл проверен: ' + file.name + ', версия ' + file.version + '.'
            : 'Вызов был, но ожидаемое сохранение или чтение файла не подтверждено.';
      if (reply.imageJob) verdict = imageVerdict(reply.imageJob);
      setResult({
        tool,
        verdict,
        text: messages.map((item) => item.content).join('\n\n'),
        ...(evidence ? { evidence } : {}),
        ...(file ? { file } : {}),
        ...(reply.imageJob ? { job: reply.imageJob } : {}),
      });
      if (!reply.imageJob || terminalImage(reply.imageJob)) remember(null);
    } catch (problem) {
      if (live.current && attempt)
        setResult((previous) => ({
          tool,
          verdict: 'Результат проверки не подтверждён.',
          text: previous?.text ?? '',
        }));
      if (
        live.current &&
        problem instanceof AiStreamClientError &&
        /^(ai_disabled|ai_input_invalid|ai_model_invalid|ai_access_denied|ai_scope_denied|ai_session_required)$/.test(
          problem.code,
        )
      ) {
        remember(null);
        setError(problem.message);
      } else if (live.current)
        setError(
          attempt
            ? 'Ответ не подтверждён. Проверьте сохранённый результат; новый запрос не отправлен.'
            : 'Проверку не удалось начать. Проверьте подключение и доступность модели.',
        );
    } finally {
      locked.current = false;
      if (live.current) setBusy(false);
    }
  }
  async function recover() {
    if (locked.current || !operation.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    const current = operation.current;
    try {
      const receipt =
        current.tool === 'generate_image'
          ? await call<AiImageGenerationJob | null>(
              '/api/ai/threads/' +
                encodeURIComponent(current.thread) +
                '/requests/' +
                encodeURIComponent(current.request) +
                '/image-generation',
            )
          : null;
      if (receipt && !receipt.ok) throw new Error('read');
      const knownJob = receipt?.ok ? receipt.data : null;
      if (knownJob) {
        if (live.current) {
          setResult({
            tool: current.tool,
            job: knownJob,
            text: result?.text ?? '',
            verdict: imageVerdict(knownJob),
          });
          if (terminalImage(knownJob)) remember(null);
        }
      } else {
        const checked = await call<{ items: Message[] }>(
          '/api/ai/threads/' +
            encodeURIComponent(current.thread) +
            '/requests/' +
            encodeURIComponent(current.request),
        );
        if (!checked.ok) throw new Error('read');
        const messages = checked.data.items.filter(
          (item) => item.role === 'assistant' && item.requestId === current.request,
        );
        // Recovering a stream cannot reconstruct tool activity: do not manufacture a successful probe.
        if (live.current) {
          setResult({
            tool: current.tool,
            verdict: messages.length
              ? 'Сохранённый ответ найден. Вызов инструмента по потерянному потоку не подтверждён.'
              : 'Результат ещё не подтверждён. Повторный запуск не выполняется.',
            text: messages.map((item) => item.content).join('\n\n'),
          });
          if (messages.length) remember(null);
        }
      }
    } catch {
      if (live.current) setError('Не удалось проверить результат. Запрос не повторялся.');
    } finally {
      locked.current = false;
      if (live.current) setBusy(false);
    }
  }
  async function stop() {
    const current = operation.current;
    if (!current) return;
    controller.current?.abort();
    const receipt =
      current.tool === 'generate_image'
        ? await call<AiImageGenerationJob | null>(
            '/api/ai/threads/' +
              encodeURIComponent(current.thread) +
              '/requests/' +
              encodeURIComponent(current.request) +
              '/image-generation',
          )
        : null;
    if (receipt && !receipt.ok) {
      if (live.current)
        setError('Не удалось проверить задание изображения. Повторный запуск не выполняется.');
      return;
    }
    const job = receipt?.ok ? receipt.data : result?.job;
    const path = job
      ? '/image-generations/' + encodeURIComponent(job.requestId) + '/cancel'
      : '/requests/' + encodeURIComponent(current.request) + '/stop';
    const stopped = await call('/api/ai/threads/' + encodeURIComponent(current.thread) + path, {
      method: 'POST',
      body: '{}',
    });
    if (!live.current || operation.current?.request !== current.request) return;
    if (stopped.ok && !job) {
      remember(null);
      setResult((previous) =>
        previous ? { ...previous, verdict: 'Проверка остановлена.' } : null,
      );
      setError('Проверка остановлена. Уже выполненные действия сохранены в тестовом диалоге.');
    } else if (stopped.ok) setError('Отмена запрошена. Проверьте результат генерации.');
    else setError('Остановка не подтверждена. Проверьте результат; новый запрос не отправлен.');
  }
  useEffect(() => {
    if (!pending || !result?.job || terminalImage(result.job) || busy) return;
    let active = true;
    const current = result;
    const timer = setTimeout(() => {
      void call<AiImageGenerationJob>(
        '/api/ai/threads/' +
          encodeURIComponent(pending.thread) +
          '/image-generations/' +
          encodeURIComponent(current.job!.requestId),
      ).then((reply) => {
        if (!active || !live.current) return;
        if (reply.ok) {
          setResult({ ...current, job: reply.data, verdict: imageVerdict(reply.data) });
          if (terminalImage(reply.data)) remember(null);
        } else
          setError('Не удалось обновить состояние изображения. Используйте «Проверить результат».');
      });
    }, 2000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pending, result, busy]);
  const recentActivities = [...new Map(activities.map((item) => [item.tool, item])).values()];
  const shown = result?.tool === tool ? result : null;
  return (
    <section className="asa-ai-tool-probe" aria-label="Проверка инструмента">
      <header>
        <h3>Проверить</h3>
        <InfoHint label="Что проверяется">
          <p>
            Настоящий запрос через выбранную модель и обычный исполнитель чата, с сохранёнными
            разрешениями и лимитами. Это проверка всей цепочки, а не прямой вызов инструмента в
            обход модели. Проверки и рабочие файлы сохраняются в вашем собственном диалоге «Проверка
            инструментов».
          </p>
        </InfoHint>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <label>
          Модель
          <select
            aria-label="Модель для проверки"
            value={model}
            disabled={busy || pending !== null}
            onChange={(event) => setModel(event.target.value)}
          >
            {(status?.modelChoices?.length
              ? status.modelChoices
              : status
                ? [{ id: status.model, label: status.model }]
                : []
            ).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {isFile(tool) ? (
          <label>
            Рабочий файл
            <input
              aria-label="Файл для проверки"
              value={name}
              maxLength={96}
              disabled={busy || pending !== null}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        ) : null}
        <label>
          Запрос
          <textarea
            aria-label="Запрос для проверки"
            value={prompt}
            rows={3}
            maxLength={2400}
            disabled={busy || pending !== null}
            onChange={(event) => setDrafts({ ...drafts, [tool]: event.target.value })}
          />
        </label>
        <div className="asa-ai-probe-actions">
          <button
            type="submit"
            disabled={
              busy ||
              pending !== null ||
              unsaved ||
              !rule?.enabled ||
              !status?.enabled ||
              status.canGenerate === false ||
              !prompt.trim()
            }
          >
            Проверить инструмент
          </button>
          {pending ? (
            <>
              <button type="button" disabled={busy} onClick={() => void recover()}>
                Проверить результат
              </button>
              <button type="button" onClick={() => void stop()}>
                Остановить
              </button>
            </>
          ) : null}
        </div>
        <small>
          Реальный запрос расходует лимиты модели. Облачная модель может списать оплату.
        </small>
        {unsaved ? (
          <p role="status">Сначала сохраните настройки.</p>
        ) : !rule?.enabled ? (
          <p role="status">
            Инструмент выключен в <a href="#/admin/ai?section=settings">Настройках</a>.
          </p>
        ) : null}
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {activities.length ? (
        <p className="asa-ai-probe-activity" role="status">
          {recentActivities
            .map(
              (item) =>
                AI_TOOL_LABELS[item.tool] + (item.state === 'running' ? '…' : ' · вызов завершён'),
            )
            .join(' → ')}
        </p>
      ) : null}
      {shown ? (
        <div className="asa-ai-probe-result">
          <strong role="status">{shown.verdict}</strong>
          {shown.text ? <p>{shown.text}</p> : null}
          {shown.evidence ? <AiWebEvidence evidence={shown.evidence} /> : null}
          {shown.file ? (
            <details>
              <summary>
                {shown.file.name} · версия {shown.file.version}
              </summary>
              <pre>{shown.file.content?.slice(0, 8000)}</pre>
              {(shown.file.content?.length ?? 0) > 8000 ? (
                <small>Показаны первые 8000 символов.</small>
              ) : null}
            </details>
          ) : null}
          {shown.job?.image && thread.current ? (
            <AiGeneratedImage image={shown.job.image} threadId={thread.current} />
          ) : null}
        </div>
      ) : null}
      {pending && !shown ? (
        <p role="status">
          Есть незавершённая проверка: {AI_TOOL_LABELS[pending.tool]}. Проверьте её результат.
        </p>
      ) : null}
    </section>
  );
}
