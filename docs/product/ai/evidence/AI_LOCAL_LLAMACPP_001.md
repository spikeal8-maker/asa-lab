# AI-LOCAL-LLAMACPP-001 — карта проверки кандидата

Issue: [#1333](https://github.com/spikeal8-maker/asa-lab/issues/1333).
Канонический выбор среза принят
[PR #1334](https://github.com/spikeal8-maker/asa-lab/pull/1334).
Это карта доказательств, а не запись owner acceptance или разрешение deployment.
Точные SHA продуктового PR, conclusions и ссылки на опубликованные CI artifacts
фиксируются в отчёте этого PR; результат другого SHA не переносится на кандидат.

## Зафиксированная последовательность

Владелец уточнил порядок 24.11.2026: сначала реализация и полная проверка в GitHub,
после зелёного CI — реальные испытания только на тестовом сервере ASA.
Школьные серверы полностью исключены: никаких последующих обращений,
диагностики, тестов или изменений. Их проверка в итоговой приёмке должна иметь
статус **NOT_RUN — исключено прямым указанием владельца**.

Служебный PR менял только выбор среза. На его точном HEAD
`fe2e77af0824141c0aaa03d14dfe69dfb2b28350`:

- [General run 45476510596](https://github.com/spikeal8-maker/asa-lab/actions/runs/45476510596)
  завершил governance, format/lint/types/build, PostgreSQL/RLS, реальные Access A
  browser journeys и `ASA / required` со статусом SUCCESS.
- Независимый read-only review: APPROVE_SOURCE.
- Merge в `main`: `954eae8f5b772fd4afabc086b01df36caf2b09e9`.
- Продуктовый preflight на этом baseline: SAFE_TO_START, чистое дерево,
  отсутствующие execution blockers и пересечения worktree, полный план файлов.

Эти результаты подтверждают baseline и порядок начала работ; они не являются
испытанием новой реализации llama.cpp.

## Baseline до продуктового изменения

Исходный код `2d40a6616ecc627acbdee7a433bc5683a4ab65c2`:

| Проверка | Наблюдённый результат |
|---|---|
| Ollama, provider stream, policy, budgets | 103/103 PASS после сборки необходимых workspace-пакетов |
| `pnpm test:ai-chat`, без Nx cache | 103 файла, 1736 PASS, 8 условно пропущены |
| Existing Ollama auto-discovery browser, 1440 и 390 px | 2/2 PASS |
| API и identity со всеми зависимостями, без cache | 19 Nx build tasks PASS |

Прежний описанный сбой Ollama auto-discovery в этом прогоне не воспроизвёлся.
Условные skips не являются успешными проверками соответствующих окружений.

## Покрытие требований продуктового кандидата

| Требование | Воспроизводимая проверка |
|---|---|
| IP, hostname, URL, default 8080, автообнаружение | Transport normalization/discovery unit и новый admin browser flow |
| Ключ и сервер без ключа | Auth/transport fixtures, endpoint binding, encrypted settings, live auth state в receipt |
| Одна и несколько моделей | Backend discovery fixtures и UI selection tests; физический multi-model server отдельно от fixtures |
| Save/reload, stale response, CAS, unknown save | Settings/SQL receipts, frontend tests, browser save/reload |
| Обычный JSON-ответ | Chat service tests и live `/api/ai/threads/:id/messages` |
| SSE и terminal usage | Fragmented transport fixtures, service tests, live browser chat и SQL usage |
| Инструменты | Safe capability probe, native dispatcher service tests, live создание виртуального файла |
| Остановка | Transport abort, session-slot cleanup, service cancellation, live Stop и terminal usage |
| Длинная история | Provider-specific history budget tests; live retrieval контрольного слова из истории свыше 96KB |
| Offline, bad key, network/stream errors | Transport/settings/UI negative fixtures; прежняя config и скрытые credentials |
| Независимость Ollama | Separate SQL configuration и baseline/provider regression; live before/after comparison |
| Остальные провайдеры | Полный `pnpm test:ai-chat`, API/Web typecheck и existing focused browser suite |
| Реальный путь с тестового ASA | Только post-CI `pnpm e2e:ai-llamacpp:live`, built API/Web, restricted role и отдельная `_test` база |
| Школьный сервер | NOT_RUN — исключён владельцем |

`pnpm test:ai-llamacpp` включает новые transport, settings, slot, chat, history,
frontend и embedded SQL tests. Реальная конкурентность разных PostgreSQL backend
подтверждается отдельно `tests/admin/ai-llamacpp.pg.spec.ts`, который входит в
существующий GitHub AI database job. PGlite не выдаётся за такую проверку.

`e2e/ai-llamacpp.spec.ts` проверяет UI с синтетическими ответами `/api` и сохраняет
screenshots на 1440/1024/390/320. Он не доказывает работу физической модели.
Live-сценарий не перехватывает успешные API-ответы, использует настоящую сессию ASA.
Его runner обязательно собирает чистый проверенный SHA без Nx cache и сохраняет
build receipt с Git tree и SHA-256 каталогов API/Web; runtime `/api/version`
не выдаётся за независимое доказательство происхождения сборки. Проверяются
история, replay и реальный журнал токенов. Секрет,
адрес и закрытые model paths не входят в агрегированный receipt; адрес и ключ
маскируются на административных screenshots.

## Границы выводов

Подтверждённый runtime context из `/props` означает только объявленную сервером
действующую ёмкость. Training context, количество символов/байтов истории и
фактический reported token usage — разные величины. Полный benchmark максимального
контекста нельзя объявлять выполненным по metadata или короткому ответу.

Прямой upstream smoke вне ASA не считается выполнением критерия «ответ через чат
ASA». Health200 не считается проверкой авторизации или генерации. Ошибка MCP
сама по себе не доказывает недоступность машины. Unknown token usage не заменяется
нулём или оценкой. Отсутствие ключа другого провайдера не доказывает его real-network
regression; это отдельно обозначается в итоговом отчёте.

Подтверждённая техническая приёмка кандидата не означает развёртывание. Постоянная
установка, рабочие данные, backup и updater остаются отдельными действиями по
каноническому execution workflow.
