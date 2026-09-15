# VSCR-M4-002 — Scratch для всех, локальные файлы

**Kind:** executable implementation slice  
**Risk:** high  
**Execution:** starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-M4-002` and `docs/execution/current.yaml.task.status` is exactly `in_progress`.

## Goal

По прямому решению владельца 16.09.2026 Scratch должен быть доступен всем
пользователям в имеющемся состоянии. Заменяется прежняя зависимость видимости
от coming_soon/preview и от завершения M4-001. Это не приёмка B/E или хранения.
Текущий пользовательский режим — native local File; серверное сохранение отдельно.

## Scope

- `BLOCKS_MODULE` active по умолчанию; API не переключает доступность preview-флагом.
- Главная и создание проектов используют существующий общий registry.
- Web не запрещает открытие при выключенном старом preview-флаге.
- Точный отдельный runtime origin обязателен; same-origin/invalid config fail closed.
- При недоступности runtime пункт не исчезает: ошибка с возвратом и повтором.
- Предупреждение: изменения пока не сохраняются в аккаунте, скачать `.sb3`.
- Школы, классы, временные ограничения не вводятся.

## Sources and tests

`contexts/blocks/module.ts`, `apps/api/src/module-registry.ts`,
`apps/web/src/blocks/BlocksEditor.tsx`, их действующие тесты;
`CreatorHomePage`, `QuickProjectCreation`, `ModuleEditorHost` — прямые consumers.
`components/module.yaml`, `components/host.yaml`, D0-005 Availability lifecycle.

## Acceptance

Registry returns active/creatable with unset, 0 and 1 legacy flags; unrelated
future modules remain gated. Runtime mounts with a valid distinct origin even
with legacy preview off. No TEST label in ordinary user mode. Ready/error/no-save
messages stay readable. Native Save/New/Load and pinned stock-media checks pass.
Existing project authorization, immutable history and server validation stay intact.

Deployment must verify the real browser-visible HTTPS/LAN origin, matching
Web/API/runtime revisions and home → create → Scratch journey on D2-R2-X.
No localhost URL is passed to external users; no hidden external Scratch backend.
Source/CI success is not deployment. Missing DNS/TLS/route is reported explicitly,
not bypassed by same-origin iframe or by silently reassigning an existing domain.

## Bounded self-review

Check changed consumers, old-flag independence, absence of new permissions and
false server-save claims, error handling and no-save warning. Run focused tests,
repository gate and browser checks; record exact revisions and topology limits.

## Independent review

A separate context reviews the exact availability/runtime/deployment changes;
it must not edit the reviewed implementation or substitute review for tests.

## Stop

No S3, JWT, autosave, school controls, arbitrary-archive safety claim or automatic
B/E/M1 acceptance. Preserve prior B evidence; resume its unclosed technical review
separately. Complete this owner-selected access slice, report evidence and stop.
