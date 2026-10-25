# Ограниченный срез диагностики памяти

Причина: прежний `runtime_metrics` показывал общую доступную память и commit,
но не позволял определить основные группы процессов и реальное использование
Windows pagefile. Это ограниченный срез порученной владельцем программы;
электроника, Scratch, покрытие источников и публикация журналов не изменены.

Добавлено `host.memoryDiagnostics` в существующую запись `runtime_metrics`.
Windows читает Toolhelp/GetProcessMemoryInfo и EnumPageFilesW без повышения прав.
Linux читает только `/proc/PID/status` и `/proc/vmstat`. Имена — безопасные
basenames, группы регистронезависимы; строки команд, окружение, URL, заголовки
окон, пути и имена файлов pagefile не сохраняются.

Контракт: top 8 групп по `workingSetBytes`, максимум 4096 рассмотренных
процессов, deadline обхода 2 секунды. Проверка deadline выполняется между
синхронными локальными API/чтениями; это не принудительное прерывание одного
зависшего системного вызова. `count`, `workingSetBytes`, `privateCommitBytes`
агрегируются по имени; RSS/working set включает shared pages и не является
уникальной физической памятью. Linux private commit — `null` с явной причиной,
поскольку VmData не эквивалентен Windows PrivateUsage. Недоступные процессы
дают `partial` и счётчик; превышение лимита/deadline имеет фиксированную причину.
Недоступный источник имеет `unavailable`, а не нулевые показатели.

Windows pagefile: реальные `totalBytes/usedBytes`. Windows paging IO пока
`unavailable/unsupported`; Linux paging — накопленные `pswpin/pswpout` в страницах,
не скорость и не общее число page faults. Существующие Windows host commit
поля дополнены `memoryCommittedBytes = commitLimitBytes - commitAvailableBytes`.
Интервал 60 секунд, durable spool и существующие command timeouts сохранены.

Сохранение: ResourceSampler хранит JSON целиком; normalize/clean сохраняет
закрытую вложенную проекцию в `LogEntry.message`. Admin worker принимает строку
до 16384 символов и не задаёт отдельную схему runtime metrics. Верхняя граница
новой проекции существенно ниже лимита. Fixture упаковки и digest runner теперь
включают новый модуль; готовый collector импортируется из временной упаковки
без помощи PYTHONPATH текущего checkout.

Проверка: 5 новых memory tests и 2 существующие collector regressions — PASS,
один прогон, 0.192 s. Включён настоящий Windows native capture без вывода имён.
Linux проверен синтетическим `/proc`, не реальной Linux установкой. Отдельный
packaging/digest regression — PASS, 0.296 s. Его первый запуск обнаружил ошибку
самого теста: `-I` исключал каталог скрипта; исправлен на `-E` с временным cwd.
`git diff --check` — PASS. Независимый review, Linux native evidence и установка
на работающем сайте ещё не выполнены; production и БД не изменены.
