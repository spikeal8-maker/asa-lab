# Agent documentation layer

Эта директория содержит машинно-проверяемую маршрутизацию документации для AI-агентов и людей.

Она **не хранит live task state**. Текущее исполнение остаётся только в `docs/execution/current.yaml`.

## Files

- `document-registry.yaml` — authority/status и routing документов;
- `schemas/*.yaml` — машинные формы Domain Contract и Surface Map;
- `contracts/*.yaml` — компактные стабильные domain invariants;
- `surfaces/*.yaml` — route/control → implementation/invariant/test map;
- `review-protocol.md` — обязательная self-review/challenge-review модель;
- архитектура системы — `docs/architecture/AI_MAINTENANCE_DOCUMENTATION_SYSTEM.md`.

## Addressed context

Для большой задачи остаётся `pnpm agent:context --scope <lane>`. Для сопровождения сначала используйте самый узкий известный адрес: `--control <CTRL-…>`, `--surface <SURF-…>` или `--path <repo-path>`. Targeted context выдаёт только затронутые файлы, compact invariants, исполнимые tests и точные escalation refs; полный Master не читается по умолчанию.

`Surface Map` хранит только стабильный bounded context (`identity`, `learning`, ...), а не execution lane. Связь context → execution lane определяется централизованно через canonical compact document и его `lanes` в `document-registry.yaml`. Если один path относится к нескольким bounded contexts, `--path` должен остановиться вместо догадки и потребовать `--surface` или `--control`.

Если bounded context имеет зарегистрированный специализированный maintenance provider (например Scratch), общий Registry маршрутизирует к нему и объявляет `delegated_roots`. Внутренние component/task cards не копируются в общий Surface Map и не становятся второй системой authority.

## Status semantics

- `canonical` — действующий authority своей области;
- `supporting` — полезный, но не источник истины;
- `historical` — исторический контекст, не руководство к новой реализации;
- `superseded` — заменён указанным canonical документом;
- `review_only` — evidence/review receipt.

Агент не выбирает между несколькими версиями master-spec самостоятельно. Если registry и фактические документы противоречат друг другу, это governance defect.
