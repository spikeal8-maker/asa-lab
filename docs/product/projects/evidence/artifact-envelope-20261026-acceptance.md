# R7-03A — техническая приёмка общего формата данных

PR [#781](https://github.com/spikeal8-maker/asa-lab/pull/781).
Окончательный источник: `cb367606632018b85e8864efd4cf066ae81e9cfc`.

- [Public Projects](https://github.com/spikeal8-maker/asa-lab/actions/runs/40336671237): SUCCESS; профильные тесты включают новый schema suite, реальные PG/API и браузерные регрессии.
- [General](https://github.com/spikeal8-maker/asa-lab/actions/runs/40336671236): SUCCESS; Governance, Code/build, PostgreSQL/RLS и полный Access/browser.
- Независимые `public_artifact_envelope_code_review` и `public_artifact_envelope_security_review`: PASS на точном SHA.
- Целевые schema tests55 PASS, contracts/test TypeScript PASS. Отсутствующие локальные built dependencies не выдавались за успешную общую проверку.

v1 — закрытый module-neutral static-only/unsupported envelope без payload,
runtime, экспорта и write capability. Публичная provenance, фиксированные
read-only capabilities, bounds, приватные/неизвестные поля и безопасные ошибки
проверяются исполнимой валидацией; результат отделён от входа и глубоко заморожен.
Это основа формата, а не работающий просмотрщик.

Промежуточный CI выявил инфраструктурную гонку удаления временного Git-каталога
(повторный Governance успешен), затем независимое форматирование каталога
Electronics (его владелец исправил Main4dd09129; значения JSON неизменны).
Собственная ошибка cross-project относительного импорта теста исправлена через
экспортированный contracts interface и точный Vitest alias, без ослабления lint.
Все обязательные проверки окончательного SHA успешны.

Раздел Games не изменялся; отложенный f41afd4c не включён. Рабочий сайт и база
не обновлялись. Дальше — фактический модульный просмотр, с точной опубликованной
версией, отдельной безопасной проекцией и read-only UI. #211 остаётся открытым.
