# Приложение OBS-015-CI-UTF8 — переносимость тестов каталогов Windows

Дата: 2026-10-14. TASK-OBSERVABILITY-001 / #551. ТЗ1.14, раздел24. Ограниченное исправление собственного тестового дефекта OBS014/015 после main integration серии15–17; не пункт18. Прежние отчёты сохранены.

## Причина и изменение

Portable contracts на main43f3fa587318d0d06acfc48e4213344d0d821c71, run38622500252/job116053283644, завершились шестью UnicodeDecodeError в трёх методах OBS014/015 при cp1252 default Python3.11 Windows. Linux и реальная PostgreSQL на том же main прошли: run38622500212,60PASS/1WindowsSKIP. UTF-8 catalog.json в тестах читался без encoding; локальный новый Python с UTF-8 default скрывал несовместимость. Продуктовый writer уже использует UTF-8.

Исправлено только пять чтений catalog.json внутри этих трёх существующих методов tools/test_collect_logs.py: явный encoding='utf-8', включая чтения после импорта/повторной публикации. Assertions, фикстуры, skip, workflow environment и продуктовые файлы не менялись. Остальные методы не подвергались cleanup.

## Версии и проверки

Канонический выбор main e3ec8cfc64004540bae1da7454decd0c90dd0578. Source 46fd6ac08f27c0663267cb2494b4166033032972. BEFORE/AFTER: Python3.11.9, внешний io.text_encoding(None)→cp1252 при неизменном настоящем pathlib.open и JSON decoder: контроль реального stream.encoding/байта0x81 подтверждён. BEFORE6 UnicodeDecodeError; AFTER3 метода/6 raw-gzip случаев PASS, окончательный exact-SHA прогон1.019 секунды. Настоящий Windows CI: exact46fd run38623836696: Windows contracts job116057850687 SUCCESS (collector61run/59PASS/2actualDBSKIP; deployment71run/69PASS/2platformSKIP), Linux contracts job116057850085 SUCCESS (collector61run/58PASS/3platform/DBSKIP; deployment71run/70PASS/1platformSKIP). После обоих завершённых SUCCESS контроллер отменил оставшуюся необязательную повторную сборку неизменных production images. Workflow в целом CANCELLED, не PASS; завершённые jobs и их логи сохранены до отмены. Image recipe/test stage ранее проверены General654fSUCCESS, продуктовый collector — exactmain43f PostgreSQL60PASS/1SKIP; эти уровни evidence не смешиваются. Ранее успешные build/browser/data suites вручную не повторялись; автоматические workflows не заменены и gates не ослаблены.

Независимый scoped read-only review exact source: PASS, дефектов не найдено; независимо проверены пять аргументов, неизменность остальных байтов файла и содержательных assertions/fixtures/skips, действительное cp1252 воспроизведение. Тесты рецензентом не повторялись. Проверка документации и текущего состояния выполнена отдельно на итоговом пакете; source-equivalence и publication SHA фиксируются в OBS-015-UTF8-main-publication.json. Evidence: E:\Asa-Lab\incoming\observability-programme-20261011, OBS-015-UTF8-* и OBS-017-Windows-CI-failure.txt.

## Ограничения и STOP

LAYOUT_IMPACT none, USER_FLOW unchanged, PORTS/DEMO_URLS/SCREENSHOTS/MAP_NODES_CHANGED none. DATABASE_ACTIONS none. Сайт, локальный Docker, рабочая БД, настоящие журналы, backup и расписания не менялись. Самостоятельного нового исправления продуктового поведения нет. Общий General CI итоговой композиции учитывается отдельно и не объявляется успешным по одному Windows gate. После обычной отправки source/отчёта в main восстанавливается STOP серии15–17. OBS018–045 не выбраны; программа45 и owner acceptance не объявлены завершёнными.

Итоговый документационный коммит использует [skip ci], поскольку после exact46fd Windows/Linux evidence меняет только отчёт и observability execution lane. Пять тестовых аргументов побайтово совпадают с reviewed/tested source46fd; нового General/Windows выполнения для документационного SHA не заявлено. Это предотвращает повтор неизменных тяжёлых suites и не меняет ни один workflow/assertion. Исходный main43f General оценивается отдельно по snapshot, его незавершённость не объявляется зелёным итогом.
