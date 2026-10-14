# ТЗ: совместимость общего Scratch fixture с журналированием

**Идентификатор:** RELEASE-SCRATCH-PROTOCOL-FIXTURE-SPEC

**Редакция:** 1.0

**Задача:** TASK-RELEASE-SCRATCH-PROTOCOL-FIXTURE-001

## Доказательство и границы

Scratch Focused 38485756130 на 35a9c99b: контракты и отдельный реальный activity/minute-save SUCCESS; общий браузерный набор 51 PASS / 4 FAIL. Два отказа непосредственно вызваны CLIENT и относятся к категории B: native File считает новые запросы журналирования запрещёнными изменениями проекта; намеренный module-session HTTP 401 даёт предусмотренное сообщение Chromium, ошибочно считающееся непредвиденной ошибкой.

Ошибка pagehide clock.pauseAt уже относится к отдельному VSCR470 acceptance blocker. Причина отсутствия draft в старом сценарии failed-server-autosave пока не доказана. Эти два сценария не меняются, их assertions и ожидания не ослабляются; новая классификация и реальное исполнение отражаются отдельно.

## Требования

1. Пять путей: tools/blocks/browser/telemetry-fixture.mjs, tools/blocks/browser/fixture.mjs, e2e/blocks-product-integration.spec.ts, e2e/classroom-scratch-time.spec.ts, tests/portal/scratch-protocol-telemetry-fixture.spec.ts. Продуктовые файлы, recovery spec, общие часы, workflow и snapshot не меняются.
2. Чистый MJS helper обслуживает только точные POST endpoint одного утверждённого parentOrigin: analytics/v2/events, analytics/v2/module-session, analytics/v2/quality, diagnostics/client, diagnostics/quality. Неизвестные методы, пути, query/prefix варианты и чужие origins не исключаются из проверки бизнес-изменений. Некорректные тела не получают выдуманного успешного ACK.
3. Общий HTTP fixture выдаёт собственные реальные квитанции endpoint с правильными HTTP 200/202, persisted/intake_acknowledged и исходными корреляционными полями. Module-session имеет корректный result с нулевым кредитом/null bounds и состоянием open/closed по операции. Ответ HTML200 не является квитанцией. Pure helper не импортирует TypeScript в прямой Node harness.
4. Исходные allRequests и pageErrors остаются полными. В native File меняется только классификация точных фоновых запросов телеметрии; все проверки проекта, кода, медиа, импорта и запрета остальных серверных изменений сохраняются.
5. Fixture дополнительно сохраняет структурированные console evidence с URL/text/type и соответствием исходной записи. В тесте намеренного 401 допускается только точное стандартное сообщение Chromium, сопоставленное с наблюдавшимся ответом HTTP 401 конкретного POST module-session. Иные 401, пустой/чужой URL, runtime/page errors и прочие сообщения остаются ошибками. Нельзя удалять записи из raw pageErrors или игнорировать ошибки по общему тексту/подстроке.
6. Unit через shipping confirmedAnalytics/confirmedQuality подтверждает потребляемость квитанций и отрицательные случаи классификатора/ожидаемой ошибки. Один focused прогон heap768/worker1, форматирование, целевой ESLint пяти путей, discovery браузера без локального исполнения. Исходные реальные CI failures являются before evidence.
7. Перед main требуется независимый просмотр точного коммита и доказательство сохранности исходных assertions. После среза выполняется полный General окончательного main и настоящий Scratch browser gate из-за изменения общего fixture; новые отказы классифицируются, известные отдельные blockers не закрываются текстом. До обновления готовые образы должны пройти Portable Release.

Исполнитель делает этот срез и останавливается. Контроллер продолжает прямо порученный выпуск и обновление; пункты OBS010–045 этим не выбираются.
