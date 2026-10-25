# Ограниченный срез: долговечный журнал использования ИИ

Исходная версия: `91587fe4`, совпадала с origin/main. Поручение владельца:
учёт использования ИИ каждого пользователя, публикация в main и STOP без
обновления работающего сайта. Этот отчёт относится к авторскому кандидату;
публикацию, независимый review и GitHub evidence проводит контроллер.

## Результат

Миграция 0244 добавляет закрытый `ai_usage_journal`. AFTER INSERT trigger на
существующем owner quota ledger атомарно сохраняет principal/Account/Seat,
request UUID и admission. Старые операции не backfill: неизвестные исторические
модели, токены и результаты не выдумываются. Журнал не имеет каскадной связи с
диалогом и переживает его удаление. Quota, replay, Seat linkage и admission
остаются существующими каноническими механизмами.

SECURITY DEFINER begin проверяет точные owner/thread/request admission и
активную lease, отличает chat/regeneration по настоящему source receipt, затем
однократно сохраняет provider, requested model, JSON/SSE и начало. Finish
фиксирует завершение, длительность, success/stopped/cancelled/failed, безопасный
error code, фактическую reported model и nullable входные/выходные токены.
Точный NULL-safe повтор завершения идемпотентен; конфликт отклоняется, первая
запись не изменяется. Незавершённый admitted/running после сбоя остаётся виден.
RLS включён, прямых runtime прав и PUBLIC EXECUTE нет, search_path фиксирован.

Все существующие JSON, SSE, изображения и повторные генерации проходят общий
service path. Begin подтверждается до генерации, а finish — после сохранения
ответа/abort. Ошибка сохранения ответа учитывается как failed с уже полученными
provider counts. Отказ финального журнала не уничтожает платный ответ и не
заменяет исходную ошибку. Повтор UUID не пишет ещё одну операцию и не вызывает
провайдера. После успешного сохранения отдельный отказ чтения истории не меняет
результат генерации.

OpenAI JSON/SSE использует reported usage, включая response.completed.response;
DeepSeek — prompt/completion counts в обычном terminal packet или совместимом
usage-only packet, с include_usage только при stream=true; Ollama —
prompt_eval_count/eval_count. Сохраняются известные usage при partial/error/abort.
Недоступные и недопустимые значения — NULL, reported zero остаётся нулём;
допускаются только неотрицательные safe integers. Requested model отделена от
actual model; отсутствие actual model не заменяется догадкой по конфигурации.
Прежние лимиты текста, stream stop и история partial answer сохранены.

Для существующего экспорта API-журналов выпускается безопасный `ai_usage` event:
portal, /api/ai, request UUID, operation/provider/model, результат, process duration
и `usage.input/output` без личности владельца. Failed имеет level:error,
cancelled/stopped — info; отказ журнала даёт pending/quality warn. Числовые
поля не называются token и не исчезают при существующей очистке коллектора.
Emitter не бросает исключений. Промпты, ответы, файлы, ключи, endpoint URL и
исходные сообщения ошибок не записываются. Канонический журнал — private DB;
server event — диагностическая проекция, а не пользовательская статистика.

Нормативное уточнение добавлено в существующий AI spec, invariant/surface map и
test catalog. Три forward-upgrade consumer обновлены только добавлением 0244;
исторические migration checksums сохранены. Новая миграция SHA-256:
`8a1a8956cbc39d0623f1f72f635cf4d2ac2a7f3937aad3e8a580f16167c5da92`.
Новые unit/PG файлы уже покрываются существующими `test:ai-chat` и wildcard
`tests/admin/ai-*.pg.spec.ts` в AI Chat Focused; package/workflow не изменялись.

## Проверки

Первый направленный запуск:

```text
vitest run apps/api/src/ai-usage-journal.spec.ts apps/api/src/ai-chat.service.spec.ts apps/api/src/ai-chat-attachments.spec.ts apps/api/src/ai-platform-quota.spec.ts apps/api/src/ai-text-history.spec.ts apps/api/src/ai-provider-stream.spec.ts apps/api/src/ai-ollama.spec.ts apps/api/src/ai-model-catalog.spec.ts
```

8 файлов, 225 tests: 223 PASS, 2 FAIL, 6.20 s. Оба FAIL — точное старое
ожидание DeepSeek request body без нового include_usage. Ожидание обновлено:
поле разрешено только при stream=true, для JSON явно проверяется отсутствие.
После этого повторены только затронутые suites, включая две добавленные
проверки known-usage cancellation и отказа emitter:

```text
vitest run apps/api/src/ai-model-catalog.spec.ts apps/api/src/ai-usage-journal.spec.ts --silent
```

47/47 PASS, 0.731 s. Незатронутые suites повторно не запускались. Usage suite:
16 tests — provider counts/NULL/zero, оба DeepSeek packet варианта, OpenAI
incomplete, Ollama error, JSON/SSE/regeneration/local, single-use begin/replay,
begin/finalize failures, primary error, сохранение платного ответа, history
failure с известным usage, cancel vs length stop, privacy и emitter failure.

`tsc --noEmit -p apps/api/tsconfig.json` — PASS. Направленный ESLint — без
ошибок; Nx module-boundary rule сообщила отсутствие cached ProjectGraph и была
пропущена, поэтому это не полный repository gate. Control-plane validator —
PASS. Code Prettier и `git diff --check` — PASS. Read-only вызов настоящего
Python normalize подтвердил round-trip numeric usage, module portal и level
error. Никаких provider network requests тесты не выполняли.

## Непроверенное и границы

Пять новых real-PostgreSQL cases подготовлены для GitHub: atomic admission
rollback, crash-state admitted/running, exact/conflicting terminal retry,
owner/Seat separation и direct privilege denial, delete survival, partial
regeneration с reported usage. Локальная PostgreSQL, Docker, рабочая БД и
реальные генерации не запускались. Историческое обновление 0244 и реальные SQL
ACL/trigger assertions ещё требуют GitHub PG evidence. Независимый review
окончательного SHA ещё требуется. Установку/миграцию на основном сайте этот
срез не выполняет; UI статистики и список разрешённых моделей не меняет.

Автор завершает один срез и STOP. Публикация и последующее подтверждение CI —
отдельные действия контроллера по действующему поручению владельца.
