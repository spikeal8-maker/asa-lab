# ТЗ: телеметрия в синтетических проверках интерфейса

**Идентификатор:** RELEASE-UI-TELEMETRY-FIXTURE-SPEC

**Редакция:** 1.0

**Задача:** TASK-RELEASE-UI-TELEMETRY-FIXTURE-001

## Причина

General 38485755516 на main 35a9c99b завершил Governance, Code и PostgreSQL успешно. Реальные сценарии Access также прошли. Синтетический интерфейс дал 371 PASS / 31 FAIL: два существующих mock учитывают новые POST журналирования как изменение настроек или класса. Ошибки относятся к /api/analytics/v2/events, /api/analytics/v2/quality и /api/diagnostics/quality. Это непосредственная несовместимость CLIENT с fixture, категория B; не доказательство изменения настроек или дефекта вёрстки.

## Требования

1. Ограниченный срез включает новый e2e/fixtures/telemetry-receipts.ts, точки обработки API в e2e/access-account-ui.spec.ts и e2e/fixtures/classroom-owner.ts, а также focused unit tests/portal/ui-telemetry-receipts.spec.ts. Продуктовый код, исходные assertions, снимки, layout budgets и workflow не меняются.
2. Только POST трёх точных endpoint обрабатывается отдельной веткой до учёта бизнес-мутаций. Событие visit получает собственную HTTP 200 persisted квитанцию с исходным eventId/receiptId/operation и корректным recordId. Product quality получает HTTP 200 persisted, diagnostics quality HTTP 202 intake_acknowledged; обе квитанции коррелируют schemaVersion/eventId/streamId/sequence/pipeline/acknowledgementStage.
3. Helper не должен принимать произвольный префикс analytics/diagnostics, другие методы или неизвестные пути. Неизвестные бизнес-мутации по-прежнему учитываются и проваливают исходные нулевые утверждения. Некорректные тела не получают выдуманного успешного ACK.
4. Существующая коллекция diagnostics/client в Account fixture сохраняется. Проверки отсутствия сохранений профиля, предпочтений, класса, печати карточек и QR не ослабляются и не переписываются фильтрами в assertions.
5. Unit проверяет точные статусы и echo receipt, отсутствие обработки чужих методов/путей и некорректных тел. Локально один focused прогон с heap768/worker1, форматирование, целевой ESLint четырёх файлов и discovery доступных UI specs. Тяжёлый браузер/build/БД исполняется только в GitHub.
6. Перед main нужен независимый просмотр точного коммита. До переключения основной установки необходим полный General окончательного main и успешный Portable Release. Реальный исправленный Scratch source 35a9c99b уже прошёл activity/minute-save step; его неизменность на новом срезе подтверждается отдельно, без выдуманного exact-SHA результата.

Исполнитель отчитывается и останавливается. Контроллер продолжает прямо разрешённый выпуск; остальные numbered OBS не выбираются автоматически.
