# Закрепления — техническая приёмка 26 октября 2026

PR: [#704](https://github.com/spikeal8-maker/asa-lab/pull/704).
Проверенный источник: `d95f1b75fa8c222aa80dbe5e2ee92f951dba8ff0`.
Миграция: `0258_project_publication_pins.sql`; опубликованная история сохранена.

Все результаты относятся к этому точному SHA:

- [General](https://github.com/spikeal8-maker/asa-lab/actions/runs/40309167651): SUCCESS; Governance, Code/build, PostgreSQL/RLS и Access/browser.
- [Public Projects](https://github.com/spikeal8-maker/asa-lab/actions/runs/40309167638): SUCCESS; реальные PostgreSQL и собранное приложение Chromium.
- [Account/admin](https://github.com/spikeal8-maker/asa-lab/actions/runs/40309167645): SUCCESS.
- Независимый Code review: `publisher_pin_code_review`, CODE_SOURCE_PASS.
- Независимый Security review: `publisher_pin_security_prescreen`, INDEPENDENT_SECURITY_SOURCE PASS.

Оба независимых рецензента связали итоговый SHA с полным рассмотренным
`793a1d48`: единственная разница — форматирование Arduino browser assertion.
Это проверки агентами, не формальный GitHub APPROVE. Владелец явно разрешил
продолжение без внешнего человека; защиты GitHub не изменялись.

Сохранена административная видимость старых публикаций из 0255. Старые записи
не получают неподдерживаемые действия закрепления. SQL сортирует до OFFSET/LIMIT;
закрепление независимо от редакционного выбора, защищено CAS и lifecycle.

Приёмка разрешает обычное слияние #704. Post-merge SHA и результаты отмечаются
отдельно в current.yaml; SUCCESS кандидата не выдаётся за post-merge запуск.
Рабочий сайт и база не обновлялись. #211, жалобы и лайки этим не закрываются.
