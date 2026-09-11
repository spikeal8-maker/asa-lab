# Agent documentation layer

Эта директория содержит машинно-проверяемую маршрутизацию документации для AI-агентов и людей.

Она **не хранит live task state**. Текущее исполнение остаётся только в `docs/execution/current.yaml`.

## Files

- `document-registry.yaml` — authority/status документов;
- `review-protocol.md` — обязательная self-review/challenge-review модель;
- будущие `surfaces/*.yaml` — route/control → implementation/test map;
- архитектура системы — `docs/architecture/AI_MAINTENANCE_DOCUMENTATION_SYSTEM.md`.

## Status semantics

- `canonical` — действующий authority своей области;
- `supporting` — полезный, но не источник истины;
- `historical` — исторический контекст, не руководство к новой реализации;
- `superseded` — заменён указанным canonical документом;
- `review_only` — evidence/review receipt.

Агент не выбирает между несколькими версиями master-spec самостоятельно. Если registry и фактические документы противоречат друг другу, это governance defect.
