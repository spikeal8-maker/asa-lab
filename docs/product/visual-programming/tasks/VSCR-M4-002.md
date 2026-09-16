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

## Owner follow-up: local navigation and loading

The owner has observed the deployed editor working. The next bounded repair uses
loopback ports on D2-R2-X; do not diagnose or change DNS, TLS, domains or FRP.
Make the ASA wordmark at the upper left an obvious, keyboard-accessible return to
ASA home, with a warning before leaving unsaved local-file work. The independent
Scratch Home/icon must not navigate out; the right-hand avatar still opens account.
Keep navigation callbacks in the parent, not inside the iframe protocol.

Measure cold and warm editor/library startup separately, including transferred
bytes and image completion. Preserve native libraries and exact pinned content.
Compress public static text and cache content-addressed media without caching
mutable entry/host/metadata files as immutable. Require negative-before/fixed-after
browser checks, local port measurements and exact-candidate CI. Do not equate
transport optimisation or this repair with ASA durable save or full B/E acceptance.

## Owner follow-up: clean editor and portable installation

The owner now explicitly requires no persistent lower strip while editing: remove
its DOM node at editor-ready; keep connection/error/retry only until recovered.
No visible no-save footnote remains in the ready editor. Local-file limitations
remain documented and the existing explicit leave confirmation is preserved.
This supersedes prior ready-state footer requirements, not the storage roadmap.

Scratch must be in the default Compose stack and standard Windows/Linux startup.
A fresh clone/ZIP must not depend on a D2-R2-X path, downloaded CI artifact, local
preview overlay or expired Actions URL. Pinned source build is the portable default.
Web/API/Scratch readiness checks must agree on the revision; a healthy portal with
missing Scratch is not installation success. Preserve secrets/volumes on repeated
startup and updates. Normal source builds retain the existing GitHub CI/backup checks. Actual production deployment
is requested, with local-port verification; no domain/FRP modifications.

## Owner follow-up: executable installation identity

The owner asks to fix the remaining gap after the documentation audit. Add a
read-only identity guard shared by standard startup and guarded update on
Windows/POSIX. Detect existing ASA services before writing a new environment,
building images or replacing containers. Reject second-checkout/project attempts,
duplicate core services, missing/mismatched deployment metadata and lost overlays;
do not silently choose a spare port or bypass a failure by another installation.
Preserve existing unrelated TEST databases and all primary credentials/data.

Test the same inventory cases on both shells and exercise startup failure before
`.env` creation with fake Docker. Existing exact-SHA portable-install checks must
still prove fresh startup and a repeat from the same root. Keep CI/backup checks.
A preflight is not a Docker-daemon permission barrier or a transaction lock:
report limits against arbitrary external commands and concurrent operators.

The known stale stateless local diagnostic may be retired only after exact
identity, mounts/data, image and lack of production routing are checked and a
rollback record is retained. Do not remove old TEST installations or volumes.
No domain, origin, UI or persistence redesign is part of this repair.
