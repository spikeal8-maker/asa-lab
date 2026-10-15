# ТЗ: ограниченное ожидание подготовки Windows junction fixture

**Идентификатор:** RELEASE-WINDOWS-JUNCTION-FIXTURE-SPEC

**Редакция:** 1.0

**Задача:** TASK-RELEASE-WINDOWS-JUNCTION-FIXTURE-001

## Доказательство и границы

Portable Release 38488975580 и 38494073569 остановили Windows contracts на одной подготовительной команде tools/deployment/test_collector.py:463: первый New-Item Junction для .asa не завершился за 15 секунд. Проверки защиты в этом subcase ещё не выполнялись. Логи доказывают timeout подготовки; холодный запуск PowerShell на hosted Windows является объяснением, согласующимся с наблюдением, но не доказанной точной причиной. Linux contracts и отдельные другие Windows runs проходили на том же коде.

## Требования

1. Единственный путь: tools/deployment/test_collector.py. Только бюджет создания junction в test_windows_real_junctions_refuse_prepare_collector_and_health_process_publication увеличивается с 15 до ограниченных 60 секунд; допустим короткий поясняющий комментарий.
2. Сохраняются все пять расположений junction, проверка reparse attribute, отказ prepare до identity, plain_paths, Collector, health/process publication, пустота внешнего target и существующий guarded os.rmdir удаления только link-entry. Не меняются production timeout 30 секунд, код коллектора, права, система, команды, cleanup, assertions и критерии отказа.
3. Запрещены skip, retry, подавление TimeoutExpired, необязательный исход проверок, общий рост timeout в других тестах, изменение workflow и любые операции с рабочими папками/данными.
4. Два реальных CI отказа являются before evidence. Локально выполняется один выбранный настоящий Windows junction test в его собственных временных папках; он не регистрирует службы/задачи и не запускает Docker/браузер. Полные 71 deployment contracts на Windows и Linux исполняются в итоговом CI, без локального широкого повтора.
5. Перед main нужен независимый просмотр точного коммита. До обновления сайта обязателен полный General окончательного main и Portable Release со всеми contracts/build/publish/backup-restore проверками.

Риск изменения ограничен ожиданием действительно зависшей подготовки до 60 секунд. Это отдельный инфраструктурный срез D для выпуска, а не изменение защитной модели или выполнение дополнительных numbered OBS. Исполнитель отчитывается и останавливается; контроллер продолжает прямо порученный выпуск.
