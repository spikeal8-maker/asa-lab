# Отчёт OBS-016 — идентичность событий при расширении схемы БД

Дата: 2026-10-14. TASK-OBSERVABILITY-001 / #551. ТЗ 1.12, раздел 21. Второй пункт разрешённой серии 15 → 16 → 17.

## Причина, воспроизведение и исправление

Настоящий Collector.database() в недавнем и историческом путях формировал идентификатор по полной строке БД. Добавление колонок изменяло этот хеш даже у неизменных событий. На исходном коде настоящая изолированная PostgreSQL с девятью искусственными таблицами сохранила 27 событий, после ALTER nullable/default колонок — 54. До исправления гипотеза воспроизведена в GitHub run38613177389, SHA6eb7746133fe7ab6496125539b2b20537a2b1b89; продуктовый сборщик в нём совпадал с исходным d4659e5.

Исправление сохраняет прежний полный raw hash для новых наблюдений. Совместимость определяется приватными хешами native key и всех значений полей, а не неполной диагностической проекцией. Проверены настоящие PK миграций: id восьми таблиц и event_hash у max_webhook_events. Отсутствующие/пустые/неподходящие native key не объединяют строки.

Добавленные поля позволяют повторно использовать прежний ID только если все прежние поля совпали, а новые значения равны доказанным PostgreSQL missing defaults (pg_attribute.atthasmissing/attmissingval в том же production COPY). Исторический индекс без новых fingerprints проверяется точным полным legacy hash после допустимого удаления хвостовых добавленных колонок по физическому порядку. Содержимое проектов, личные тексты и произвольные поля не становятся критерием публичного объединения. Реальное изменение прежнего или добавленного поля, включая непубличное поле, сохраняет отдельное наблюдение.

Производные приватные данные — SHA-256 fingerprints, один snapshot на удерживаемое событие, предел 256 колонок и ограниченный native input. Кандидаты читаются потоком, без ограничения числа законных наблюдений одного ключа. Метаданные удаляются вместе с истёкшими/вытесненными событиями. Оригинальные сегменты и старые ID не переписываются. Курсоры/окна/периоды запроса не менялись: пункт 17 здесь не выполнялся.

Пять изменённых файлов: tools/collect_logs.py, tools/test_collect_logs.py, новый tools/test_database_identity.py, docs/testing/test-catalog.yaml и новый .github/workflows/observability-database.yml. Новый focused workflow выполняет канонический Python runner на изолированном PostgreSQL без сборки сайта.

## Версии и проверки

Канонический выбор/main: d4659e5c6a0d7025ab73eada73e7451aeae10df4. Исправление автора: 46b0ae4adabbe1c47c1f50d18d2e4fd43b941cd0. Конечный исходник: 3843956f0b33383ac32d3104680e961e7d818405, ветка codex/observability-item-16. Одна обычная merge-конвергенция сохранила чужие изменения main74a348a33e64731c670746fd8bd23349fb584f20; все пять своих файлов совпали с протестированными. Первый merge не начался из-за отсутствия committer identity; recovery подтвердил чистоту и отсутствие MERGE_HEAD, затем применена command-local identity без переписывания истории.

Каноническая команда: `python -B tools/test_collect_logs.py`.

- Исходный actual PostgreSQL CI: FAIL, 27 → 54 после ALTER; это доказанный дефект пункта 16.
- Окончательный локальный прогон: 57 запущено, 56 PASS, 1 SKIP actual DB, 19.014 секунды; локальный Docker не использовался.
- Прогон исправленного авторского исходника в настоящей PostgreSQL: 57 запущено, 56 PASS, 1 Windows-only SKIP, 19.810 секунды; run38613992987.
- Окончательный exact-SHA actual PostgreSQL CI на 3843956f: **SUCCESS**, run38614199354; 57 запущено, 56 PASS, 1 Windows-only SKIP, 16.202 секунды. Это focused CI, не весь repository gate.
- Test catalog validator PASS, 96 зарегистрированных тестов. Кэш вместо выполнения не применялся.

Фактический production путь: Collector.database → command → docker exec → sh → psql с настоящим SQL, без подставленных query rows или SQL adapter. DB fixture требует ASA_OBS_DATABASE_TEST=1/GITHUB_ACTIONS=true, явно переданный container ID, имя БД с _test, искусственные CI credentials; отвергает Compose установку. Проверка старого индекса использует прежнюю full-row identity на настоящих SQL строках и повторное открытие без новой таблицы fingerprints.

Результат реальной БД: неизменные ID и count 27 → 27, повтор 27; изменение счётчика 28, непубличного поля 29, нового default-поля 30. Повтор изменений идемпотентен. Сохранённые gzip bytes не изменились; контрольные личные значения отсутствуют в публичном хранилище. Unit regressions дополнительно покрывают обычную/gzip историю, разные native ID при одинаковой диагностике, отсутствие доказанного default, неверные ключи, предел колонок, 260 законных mutable наблюдений и retention cleanup.

## Независимый просмотр и ограничения

Независимый критический review точного 3843956f: PASS, actionable defects не обнаружены. Проверены PK всех девяти источников, полнота хешей, доказательство default и legacy lookup, границы/очистка metadata, транзакции/курсор и безопасная реальная CI fixture. Авторские прогоны не повторялись. POST_STEP_REVIEW: L3_CRITICAL, private identity compatibility/immutable history. Layout impact none; UI, API, tenant/RLS и application migrations не менялись.

Приёмка ограничена добавочными nullable/доказанными constant-default изменениями схемы. Volatile default без missing-value proof не даёт права тихо объединять события; rename/drop/destructive schema migration не объявляются совместимыми. Пропуск платформенной проверки указан явно. Не выполнялись full build/repository/browser gate и школьная приёмка. Эта проверка не определяет причину прежних вылетов Scratch и не закрывает остальные пункты программы.

## GitHub, сайт и остановка

Source отправлен в feature branch; main интеграция выполняется контроллером после независимого PASS и документальных валидаторов. Точный main SHA, remote и чистота фиксируются в OBS-016-main-publication.json. Старые отчёты, другие lanes и blockers сохранены. Полный GitHub General CI оценивается отдельно, focused SUCCESS его не заменяет.

Сайт не обновлялся. DATABASE_ACTIONS: только искусственная изолированная PostgreSQL GitHub CI, никаких действий с рабочей БД. Настоящие журналы, локальный Docker, backups и расписания не менялись. PORTS/DEMO_URLS/SCREENSHOTS/MAP_NODES_CHANGED: изменений нет. WORKING_TREE: clean перед root report; final verification после push.

Evidence: E:\Asa-Lab\incoming\observability-programme-20261011, OBS-016-author-self-review.md, source-manifest.json, baseline-ci.txt, final-local.txt, final-ci.json/txt, final-snapshot.txt, test-catalog.txt. Автор и независимый рецензент STOP после своего результата; контроллер продолжает только разрешённый 17 после принятия 16. После 17 серия STOP.

Перед итоговой отправкой выполнено одно дополнительное сохранение чужой истории с main f603cc4b95eb4c20f03c73c74ed8ee45cef90072 (только electronics task card и чужая execution lane). Преддокументальный integration SHA5565f8877dcfd328ab9b2ecbdb48f113dcb24972. Все пять проверенных/рецензированных файлов идентичны 3843956f; focused CI SUCCESS относится к исходнику384, не объявлен новым полным CI для композиции.
