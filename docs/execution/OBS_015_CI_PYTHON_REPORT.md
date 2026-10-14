# Приложение OBS-015-CI-PYTHON — среда настоящих проверок журналов

Дата: 2026-10-14. TASK-OBSERVABILITY-001 / #551. ТЗ 1.13, раздел 23. Обязательное ограниченное исправление обнаруженного CI baseline; не новый пункт 18. Исторический OBS_015_REPORT.md сохранён без изменений.

## Причина и исправление

Общий CI исходника 90ed457646d399f020d88fc6f113e5092079a6ed, run38611190772, подтвердил пять падений настоящих fixtures OBS012/014/015: spawnSync python ENOENT. Остальные 3983 теста прошли; code и browser jobs прошли. В disposable test-runner не было executable python, нужного неизменённым фикстурам запуска настоящего Python-сборщика. Это собственная недостающая зависимость тестовой среды.

Свежий ограниченный исполнитель изменил только Dockerfile.api: test stage устанавливает python3/python-is-python3 без рекомендуемых пакетов, удаляет apt lists; после USER node проверяет literal python, импорты gzip/json/sqlite3/tempfile/zipfile и настоящий SQLite SELECT в памяти. Production runtime, workspace/browser stages побайтово сохранены. Закреплённые image identities, gates, fixtures/assertions, auth/RLS и lockfiles не менялись.

## Версии, проверки и независимый просмотр

Канонический выбор main db94f4e7530ef2598bcbd8ce63434f481baa48c8. Авторский source654f3d620d98d0f935e2c1d9f5746a2349305fb6, codex/observability-python-fixture. Scoped preflight SAFE_TO_START; git diff --check, существующий semantic image transport guard (5 immutable mappings), точная обратимость двух добавленных блоков и parse smoke PASS. Это статическая проверка, не выполненная сборка образа.

Фактическая проверка образа и пяти исходных fixtures: SUCCESS: настоящий test stage установлен и собран, nonroot Python/SQLite smoke прошёл; 3990 PASS в 424 файлах и16 RLS PASS. Пять исходных collector fixtures сохранены и прошли в admin-logs.worker.spec.ts (24 tests). Первая попытка остановилась до сборки на внешнем ECR HTTP429; один повтор только упавшего data job на том же source SHA дал успех, успешные code/browser jobs не повторялись. Это attempt2, job116048575513. Единственный автоматический General run38617737022 для exact654f: https://github.com/spikeal8-maker/asa-lab/actions/runs/38617737022 . Повтор неизменного тяжёлого CI и локальный Docker не запускались.

Независимый scoped review exact654f: PASS, дефектов не найдено; независимо подтверждены stage byte hashes и неизменность assertions/gates. Новая композиция с main796f/OBS017 имеет отдельный автоматический CI, его успех заранее не заявляется. Evidence: E:\Asa-Lab\incoming\observability-programme-20261011, OBS-015-python-fixture-static-proof.json, self-review.txt, hashes.json, independent-review.txt и CI evidence. Контроллер выполнил документальные validators на итоговой композиции, результат в publication evidence.

## Границы результата

LAYOUT_IMPACT none; UI и пользовательские потоки не менялись. DATABASE_ACTIONS: только CI disposable PostgreSQL и in-memory smoke, рабочая БД не затрагивалась. Сайт, локальный Docker, настоящие журналы, backups и расписания не менялись. Публикация в main не означает deployment, owner acceptance или завершение всех 45 пунктов. После принятия baseline контроллер возобновляет сохранённый OBS017 и останавливается после серии 15–17; OBS018 не выбран.
