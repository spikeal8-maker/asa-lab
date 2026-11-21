import {
  AI_TOOL_IDS,
  AI_TOOL_LABELS,
  AI_TOOL_DEPENDENCIES,
  type AiToolId,
} from '@asa-lab/contracts';
import type pg from 'pg';
import type { NativeToolName } from './ai-native-tools.js';

export const TOOL_IDS = AI_TOOL_IDS;
export type ToolId = AiToolId;
export interface ToolRule {
  readonly id: ToolId;
  readonly enabled: boolean;
  readonly instructions: string;
}
export interface ToolPolicy {
  readonly configurationVersion: number;
  readonly tools: readonly ToolRule[];
}
export interface ToolPolicyUpdate {
  readonly schemaVersion: 1;
  readonly expectedConfigurationVersion: number;
  readonly requestId: string;
  readonly tools: readonly ToolRule[];
}
export class AiToolPolicyError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const defaults: readonly ToolRule[] = TOOL_IDS.map((id) => ({
  id,
  enabled: false,
  instructions: '',
}));
const fallback: ToolPolicy = { configurationVersion: 0, tools: defaults };
export const toolMetadata: Record<
  ToolId,
  {
    label: string;
    usageDescription: string;
    parameters: string[];
    resultDescription: string;
    hardLimits: string[];
  }
> = {
  read_page: {
    label: AI_TOOL_LABELS.read_page,
    usageDescription:
      'Читает публичную ссылку пользователя или выбранные страницы из выдачи. Разрешение задаётся отдельно от поиска.',
    parameters: ['url: ссылка из сообщения либо sourceIds: выбранные источники'],
    resultDescription: 'Извлечённый текст, источник и сведения о неполноте чтения.',
    hardLimits: [
      'Только публичный HTTPS, проверка адресов и перенаправлений.',
      'Лимиты страниц и текста сохраняются; JavaScript сайта не выполняется.',
    ],
  },
  create_working_file: {
    label: AI_TOOL_LABELS.create_working_file,
    usageDescription:
      'Создаёт новый рабочий файл этого чата или сохраняет уже написанный блок кода.',
    parameters: ['name и content либо name, sourceMessageId и blockIndex'],
    resultDescription:
      'Рабочий файл с первой версией и доступным предпросмотром для поддерживаемого формата.',
    hardLimits: [
      'Только собственный чат, разрешённые форматы и существующие лимиты размера.',
      'Не предоставляет доступ к диску или запуск команд.',
    ],
  },
  read_working_file: {
    label: AI_TOOL_LABELS.read_working_file,
    usageDescription: 'Читает существующий рабочий файл перед анализом или правкой.',
    parameters: ['name и необязательная version'],
    resultDescription: 'Содержимое конкретной версии собственного файла.',
    hardLimits: [
      'Проверка владельца и чата обязательна.',
      'Не открывает все файлы пользователя или репозиторий.',
    ],
  },
  edit_working_file: {
    label: AI_TOOL_LABELS.edit_working_file,
    usageDescription: 'Меняет уже созданный файл, сохраняя его идентичность и историю версий.',
    parameters: ['name, expectedVersion, edits: пары oldText/newText'],
    resultDescription: 'Новая версия того же файла либо явный конфликт.',
    hardLimits: [
      'До 12 однозначных замен, проверка ожидаемой версии.',
      'Конфликт не перезаписывает чужое изменение; права проверяются перед вызовом.',
    ],
  },
  weather: {
    label: AI_TOOL_LABELS.weather,
    usageDescription:
      'В режиме «Авто» выбранная подключённая модель с поддержкой tools может запросить прогноз для города, названного пользователем, если политика, источник и лимит позволяют. При явном выборе «Погода» ASA подготавливает прогноз до ответа модели.',
    parameters: ['city: название города, до 100 символов'],
    resultDescription: 'Прогноз MET Norway с датой обновления, часами и источником.',
    hardLimits: [
      'Город проверяется сервером; адрес и геопозиция не угадываются.',
      'Действуют общий часовой лимит и 18-секундный предел поиска.',
    ],
  },
  web_search: {
    label: AI_TOOL_LABELS.web_search,
    usageDescription:
      'В режиме «Авто» выбранная подключённая модель с поддержкой tools может искать свежие сведения, когда сервер разрешил инструмент и источник готов. При явном выборе интернет-поиска ASA подготавливает ссылки до ответа модели.',
    parameters: ['query: запрос, до 400 символов'],
    resultDescription:
      'До 8 ссылок и поисковые выдержки. В режиме «Авто» модель может вызвать read_page для выбранных источников и получить текст страницы либо явный отказ.',
    hardLimits: [
      'Только бесплатный SearxNG; доменные фильтры и защита приватных адресов обязательны.',
      'Одна операция на запрос; действует общий часовой лимит.',
      'read_page: ссылка пользователя либо страницы из поиска. Количество страниц (0–2) и текст (500–8000 символов) задаются в настройках. До двух доступных растровых изображений передаются только модели с Vision, в пределах общего бюджета вложений. 6 секунд и 512 КБ на HTML-страницу. Только публичный HTTPS; JavaScript сайта не выполняется.',
    ],
  },
  image_search: {
    label: AI_TOOL_LABELS.image_search,
    usageDescription:
      'В режиме «Авто» выбранная подключённая модель с поддержкой tools может искать уже существующие изображения. При явном выборе поиска изображений ASA подготавливает результаты до ответа модели; пиксели найденных картинок модель не видит.',
    parameters: ['query: запрос, до 400 символов'],
    resultDescription: 'Метаданные найденных изображений и приватный preview proxy.',
    hardLimits: [
      'Строгий safesearch и серверная проверка запроса обязательны.',
      'Метаданные не подтверждают содержимое пикселей; доменные фильтры и лимит обязательны.',
    ],
  },
  generate_image: {
    label: AI_TOOL_LABELS.generate_image,
    usageDescription:
      'В режиме «Авто» выбранная подключённая модель с поддержкой tools может создать новое изображение, если генератор готов, размер разрешён и дневной лимит не исчерпан. Явный выбор FLUX.2 Klein 4B создаёт отдельное задание с серверной проверкой; прежние пиксели не редактируются.',
    parameters: [
      'prompt: сцена, до 3000 символов',
      'size: разрешённый ID пресета с указанными шириной и высотой',
      'model: FLUX.2 Klein 4B',
    ],
    resultDescription: 'Сохранённое задание генерации изображения.',
    hardLimits: [
      'Доступна только локальная модель FLUX.2 Klein 4B.',
      'Размер, пользовательский лимит и однократный dispatch проверяет сервер.',
    ],
  },
};
export function validateToolPolicyUpdate(raw: unknown): ToolPolicyUpdate {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new AiToolPolicyError('ai_tool_policy_invalid', 400, 'Неверные настройки инструментов.');
  const v = raw as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(',') !==
      'expectedConfigurationVersion,requestId,schemaVersion,tools' ||
    v.schemaVersion !== 1 ||
    !Number.isSafeInteger(v.expectedConfigurationVersion) ||
    Number(v.expectedConfigurationVersion) < 1 ||
    typeof v.requestId !== 'string' ||
    !UUID.test(v.requestId) ||
    !Array.isArray(v.tools) ||
    v.tools.length !== TOOL_IDS.length
  )
    throw new AiToolPolicyError('ai_tool_policy_invalid', 400, 'Неверные настройки инструментов.');
  const ids = new Set<string>();
  for (const item of v.tools) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new AiToolPolicyError('ai_tool_policy_invalid', 400, 'Неверные настройки инструмента.');
    const rule = item as Record<string, unknown>;
    if (
      Object.keys(rule).sort().join(',') !== 'enabled,id,instructions' ||
      !TOOL_IDS.includes(rule.id as ToolId) ||
      typeof rule.enabled !== 'boolean' ||
      typeof rule.instructions !== 'string' ||
      rule.instructions.length > 3000 ||
      /\p{Cc}/u.test(rule.instructions) ||
      ids.has(rule.id as string)
    )
      throw new AiToolPolicyError(
        'ai_tool_policy_invalid',
        400,
        'Проверьте названия и инструкции инструментов.',
      );
    ids.add(rule.id as string);
  }
  return {
    schemaVersion: 1,
    expectedConfigurationVersion: v.expectedConfigurationVersion as number,
    requestId: v.requestId.toLowerCase(),
    tools: v.tools as ToolRule[],
  };
}
function policy(value: unknown): ToolPolicy {
  if (!value || typeof value !== 'object')
    throw new AiToolPolicyError(
      'ai_tool_policy_unavailable',
      503,
      'Политика инструментов недоступна.',
    );
  const raw = value as { revision?: unknown; tools?: unknown };
  if (Array.isArray(raw.tools) && raw.tools.length === 4) {
    const legacy = raw.tools as ToolRule[];
    const ids = new Set(legacy.map((item) => item?.id));
    if (
      ['weather', 'web_search', 'image_search', 'generate_image'].every((id) =>
        ids.has(id as ToolId),
      )
    ) {
      raw.tools = [
        ...legacy,
        {
          id: 'read_page',
          enabled: legacy.find((item) => item.id === 'web_search')?.enabled === true,
          instructions: '',
        },
        ...(['create_working_file', 'read_working_file', 'edit_working_file'] as const).map(
          (id) => ({ id, enabled: true, instructions: '' }),
        ),
      ];
    }
  }
  if (
    !Number.isSafeInteger(Number(raw.revision)) ||
    !Array.isArray(raw.tools) ||
    raw.tools.length !== TOOL_IDS.length
  )
    throw new AiToolPolicyError(
      'ai_tool_policy_unavailable',
      503,
      'Политика инструментов недоступна.',
    );
  const byId = new Map((raw.tools as ToolRule[]).map((item) => [item.id, item]));
  if (
    TOOL_IDS.some(
      (id) =>
        !byId.has(id) ||
        typeof byId.get(id)?.enabled !== 'boolean' ||
        typeof byId.get(id)?.instructions !== 'string',
    )
  )
    throw new AiToolPolicyError(
      'ai_tool_policy_unavailable',
      503,
      'Политика инструментов недоступна.',
    );
  return { configurationVersion: Number(raw.revision), tools: TOOL_IDS.map((id) => byId.get(id)!) };
}
export function toolRule(p: ToolPolicy, id: NativeToolName): ToolRule {
  return p.tools.find((item) => item.id === id) ?? { id, enabled: false, instructions: '' };
}
export function toolEnabled(p: ToolPolicy, id: ToolId): boolean {
  return (
    toolRule(p, id).enabled &&
    AI_TOOL_DEPENDENCIES[id].every((dependency) => toolRule(p, dependency).enabled)
  );
}
export class AiToolPolicyService {
  constructor(private readonly pool: pg.Pool) {}
  async schemaReady(): Promise<boolean> {
    const r = await this.pool.query<{ ready: boolean }>(
      "SELECT to_regprocedure('public.ai_tool_policy_permit(uuid,uuid,uuid,text)') IS NOT NULL AS ready",
    );
    return r.rows[0]?.ready === true;
  }
  async runtime(): Promise<ToolPolicy> {
    if (!(await this.schemaReady())) return fallback;
    const r = await this.pool.query<{ value: unknown }>('SELECT ai_tool_policy_runtime() AS value');
    return policy(r.rows[0]?.value);
  }
  async snapshot(owner: string, thread: string, request: string): Promise<ToolPolicy> {
    if (!(await this.schemaReady())) return fallback;
    const r = await this.pool.query<{ value: unknown }>(
      'SELECT ai_tool_policy_snapshot($1,$2,$3) AS value',
      [owner, thread, request],
    );
    return policy(r.rows[0]?.value);
  }
  async admin(actor: string): Promise<{ ready: boolean; policy: ToolPolicy }> {
    if (!(await this.schemaReady())) return { ready: false, policy: fallback };
    const r = await this.pool.query<{ value: unknown }>(
      'SELECT ai_tool_policy_admin_get($1) AS value',
      [actor],
    );
    return { ready: true, policy: policy(r.rows[0]?.value) };
  }
  async save(actor: string, raw: unknown): Promise<ToolPolicy> {
    const input = validateToolPolicyUpdate(raw);
    if (!(await this.schemaReady()))
      throw new AiToolPolicyError(
        'ai_tool_policy_unavailable',
        503,
        'Политика инструментов ещё не установлена.',
      );
    try {
      const r = await this.pool.query<{ value: unknown }>(
        'SELECT ai_tool_policy_set($1,$2::bigint,$3::uuid,$4::jsonb) AS value',
        [actor, input.expectedConfigurationVersion, input.requestId, JSON.stringify(input.tools)],
      );
      return policy(r.rows[0]?.value);
    } catch (error) {
      if ((error as { code?: string }).code === '40001')
        throw new AiToolPolicyError(
          'ai_tool_policy_changed',
          409,
          'Политика изменилась. Обновите страницу.',
        );
      if ((error as { code?: string }).code === '22023')
        throw new AiToolPolicyError(
          'ai_tool_policy_invalid',
          400,
          'Запрос или настройки инструментов не совпадают.',
        );
      throw error;
    }
  }
  async assertAllowed(owner: string, thread: string, request: string, tool: ToolId): Promise<void> {
    if (!(await this.allowed(owner, thread, request, tool)))
      throw new AiToolPolicyError(
        'ai_tool_disabled',
        403,
        'Инструмент недоступен для этого запроса.',
      );
  }
  async allowed(owner: string, thread: string, request: string, tool: ToolId): Promise<boolean> {
    if (!(await this.schemaReady())) return false;
    const result = await this.pool.query<{ value: boolean }>(
      'SELECT ai_tool_policy_permit($1,$2,$3,$4) AS value',
      [owner, thread, request, tool],
    );
    return result.rows[0]?.value === true;
  }
  async manualImageAllowed(owner: string, thread: string, request: string): Promise<boolean> {
    if (!(await this.schemaReady())) return false;
    const r = await this.pool.query<{ value: boolean }>(
      'SELECT ai_tool_policy_image_permit($1,$2,$3) AS value',
      [owner, thread, request],
    );
    return r.rows[0]?.value === true;
  }
}
