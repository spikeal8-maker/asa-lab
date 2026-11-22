---
task_id: TASK-ELECTRONICS-ULTRASONIC-U09-001
kind: deployment
risk: critical
semantic_change: no
roadmap_slice: null
prerequisites:
  - TASK-ELECTRONICS-ULTRASONIC-U08-001
  - owner-selected exact release SHA and existing installation
acceptance_boundary: slice
review: independent
---

# U09 — отдельно принять эксплуатационную установку

## Один результат и вход

Проверенная существующая установка работает на выбранном неизменяемом release
SHA, и владелец принимает оба ультразвуковых датчика через свой фактический вход.
Component IDs: `electronics.delivery.deployment`, `electronics.delivery.rollback`.
Карточка не разрешает deployment сама по себе: нужен отдельно выбранный
executable scope, принятое U08 и авторизация владельца на эту установку.

Прочитать root AGENTS, [START_HERE](../START_HERE.md), только два delivery entries
из `components/delivery-portability.yaml`,
[deployment template](DEPLOYMENT_TASK_TEMPLATE.md),
[workflow §5](../../../delivery/AGENT_CHANGE_WORKFLOW.md#5-обнови-существующую-docker-установку),
[workflow §7](../../../delivery/AGENT_CHANGE_WORKFLOW.md#7-резервная-копия-и-восстановление),
[guarded updater](../../../deployment/GUARDED_UPDATE.md),
[ТЗ §9](../contracts/ULTRASONIC_EXECUTION_SPEC.md#9-критерий-полного-завершения).
Acceptance: **UL-R02**. Не повторять roadmap implementation и не закрывать U08
по одной доступности сервера.

## Target и разрешённые изменения

До live action в execution/evidence записать точные target SHA, previous deployed
SHA, выбранную установку, public entry origin, canonical checkout, текущие
Compose project/overlays/ports и источник PostgreSQL. Эти значения читаются из
actual services/current selection, не хранятся как изменяемое состояние карточки.
Target SHA не следует за движущимся main.

Production source files: **0**. Repository write path только
`docs/product/electronics/evidence/ultrasonic-u09-deployment-acceptance.md`.
Операционные backup/receipt/image paths определяются существующим updater для
конкретной установки и записываются до switch. Private env/secrets не публикуются.
`tools/docker-update.sh`, `tools/docker-update.ps1`, `tools/asa-manager.sh`,
Compose и deployment scripts — read-only контекст, не repair scope.

## До переключения

1. Independent reviewer проверяет exact release evidence U08 и release delta:
   source, Compose/env, schema/migrations, services, ports, secrets, image provenance.
   Неожиданная destructive persistence/RLS/schema change — STOP/CRITICAL review.
2. Определить канонический каталог по labels **работающей PostgreSQL**. Проверить
   API/Web/Scratch и отсутствие смешения checkout. Feature worktree не становится
   deployment root; новый Compose project/port/DB ради обхода не создаётся.
3. Приняты backup, проверка читаемости/восстановления по deployment contract,
   previous image IDs/revision/schema, private env/overlay copies и конкретный
   rollback command. Rollback не сочиняется после неудачного switch.
4. Штатный check должен показать именно выбранный target и обязательный зелёный
   CI этого SHA. Для source installation существует команда
   `bash tools/docker-update.sh --check`; нужные profile/entry-origin передаются
   в точном виде из выбранной установки по workflow, а не из примера другого сайта.

У `docker-update.sh` нет опции `--sha`: source updater использует origin/main и
fast-forward. Нельзя придумывать параметр или незаметно принять новый target.
Если выбранный SHA не может быть обеспечен штатным механизмом, контроллер
согласует release/integration window либо применимый утверждённый immutable
release route **до** switch. Не менять updater в U09. Для установки published
releases применяется её существующий manager route, а не source updater.

## Switch и приёмка

После предыдущих доказательств и отдельного выбора владельцем выполнить
штатный updater из canonical root с проверенными configuration arguments.
Не использовать ручной `git pull && compose up` как замену guarded flow.
PostgreSQL container/volume сохраняется, если иной database action не выбран
отдельно. Не удалять backup/rollback package после первого health PASS.

Проверить точный target SHA у API `/api/version`, Web `build-metadata.json` и
Scratch `asa-commit.txt`, schemaVersion/expectedSchemaVersion где guard применим,
service health/readiness, внешний реальный origin и `/internal/blocks/`.
HTTP readiness не закрывает пользовательскую проверку.

Через реальный browser вход владельца: открыть проект, проверить оба вида
датчика и их `?` help; выполнить text и blocks measurement, 100 см →5800 мкс,
изменить distance полем/ползунком/целью, проверить no-reflection, Run/Pause/Stop,
сохранить и открыть снова. Убедиться, что это новый Worker asset и выбранная
revision, а не старый browser cache. Схема, source и initial distance целы.
Неуспех обязательного acceptance запускает подготовленный rollback; product code
не исправляется на работающей установке внутри deployment.

## Проверки, отчёт и STOP

На выбранном root lane доступны read-only entry commands:

```bash
pnpm agent:preflight --scope electronics --check
pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-ULTRASONIC-U09-001
git diff --check
```

Child deployment lane использует свой канонически выбранный scope. Конкретные
operator commands, target, paths и origins в evidence должны быть полностью
развёрнуты; не выдавать неизвестные значения за готовую к запуску команду.
К отчёту ТЗ §8 добавить TARGET_SHA, PREVIOUS_SHA, MIGRATIONS_APPLIED,
DB_RESTARTED, BACKUP_PATH, ROLLBACK_IMAGE_TAGS, LOCAL_HEALTH, EXTERNAL_HEALTH,
VERSION_SCHEMA, USER_FLOW, ROLLBACK_USED и результат приёмки владельца.

Новый independent review относится к exact release и фактическим operational
receipts. Закрытие родительской задачи возможно только после UL-R02 и owner
acceptance. При недостатке доступа/доказательств конкретный пункт остаётся
NOT_VERIFIED/BLOCKED; успешный docs PR или merge не превращается в deployment.
После завершения исполнитель STOP, новое развитие требует отдельного среза.
