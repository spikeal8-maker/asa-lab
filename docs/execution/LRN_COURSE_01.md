# LRN-COURSE-01 — исполнение и исправления E1

Этот файл — постоянный пакет выполнения, не источник status/checkpoint/SHA. Выбранная работа находится только в `current.yaml`, lane learning; продуктовый scope связан с Issue #179. Doc rebaseline не является приёмкой кода и не разрешает deployment.

## Прочитать

`AGENTS.md` → `agent:recover --scope learning --check` → `agent:context --scope learning` → выбранный E1-FIX-ID в Requirements Ledger → Integrated V1.5 §4 и точные разделы Learning/Access 2.2. Архив не загружается без конкретного исторического вопроса.

## Цель

Один законченный курс от автора и законной выдачи доступа до exact project Submission, review/revision и canonical Gradebook. Существующие identity/runtime/projections переиспользуются, но факт их существования не освобождает от negative/retry/concurrent тестов. Успешный старый CI не отменяет найденные дефекты.

## Порядок ограниченных срезов

1. E1-FIX-01…03: массовый StudentSeat-вход с одного IP, непредсказуемые короткие коды и защищённый repeated readback, правильный class-only QR/публичный host.
2. E1-FIX-04…05: защита всей навигации и inflight editor input, idempotent publish после lost response.
3. E1-FIX-06…08: concrete structural/policy diff, точные prepublish errors и корректный legacy-picker, atomic archive/assign.
4. E1-FIX-09: согласованность active docs и реально запускаемых regression cases; выполняется вместе с соответствующим срезом, без второго отчётного состояния.
5. E1-FIX-10: exact product candidate, независимый review по policy, полные требуемые gates, owner-visible synthetic journey; deployment и smoke asa-lab.ru отдельно разрешаются и фиксируются.
6. После функциональной приёмки — отдельный visual convergence библиотеки/курса/класса. Читаемость, доступность CTA и сохранность не считаются отложенной косметикой.

Порядок — не разрешение исполнителю автоматически проходить все пункты за один запуск. Выбирается один законченный user transition. Product code, docs-only correction и server update не смешиваются в отчёте.

## Приёмка среза

Сначала воспроизвести проблему на baseline либо записать source-only hypothesis. Regression должен падать по требуемой причине до исправления. После repair: happy path, соседний forbidden scope, retry/lost response, concurrent/stale state, сохранение истории. E1-FIX-08 не объявляется фактически проявившимся инцидентом без воспроизведения.

Использовать существующие `pnpm test:learning-e1`, `pnpm e2e:learning-e1` и Access-A по затронутому пути. Полный `pnpm gate:repository` требует настоящей изолированной БД; отсутствие БД нельзя назвать PASS. Doc-only проверка использует governance и свой semantic-doc validator. Планируемые случаи в ledger не выдаются за выполненные тесты.

## Финальная граница

Все критерии Integrated §4.15 плюс применимые E1-FIX scenarios должны иметь exact evidence. Без правильного домена, работающего NAT-входа, защищённого draft и достоверного retry кандидат не принят. Владелец отдельно принимает демонстрацию; сервер обновляется только по прямому поручению. После deployment проверяются Web/API SHA, схема и разрешённый полный user journey именно на https://asa-lab.ru/.

E2–E6, посещаемость, новая RLS/tenant модель, предметные ядра и массовая очистка старых миграций не входят в этот пакет исправлений. ТЗ по следующим стадиям сохраняется; следующее разрешение не выводится из зелёного предыдущего теста.
