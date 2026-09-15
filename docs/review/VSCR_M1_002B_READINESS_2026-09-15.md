# Scratch B — проверка готовности к 002E, 2026-09-15

Датированный отчёт, не источник активной задачи. Execution authority: `docs/execution/current.yaml`.

## Объём и вердикт

Проверить интегрированный B после merge #255 и определить, можно ли переходить к 002E. Не писать runtime API, storage, autosave или новый интерфейс.

**Проверенный продуктовый SHA:** `218a7b68ed9e3c4445471187bad0646ed1e50e25`.
**Вердикт готовности B:** `NEEDS_FIX` — обнаружено наложение двух служебных статусов, [issue #256](https://github.com/spikeal8-maker/asa-lab/issues/256).
**002E не выбран и не выполнен.** Приёмка всего B и всего M1-002 не объявляется завершённой. Функциональный CI зелёный, но не заменяет layout-приёмку.

## Подтверждённый CI именно main

| Workflow                          | Run                                                                               | Проверенный результат                                        |
| --------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Scratch Focused                   | [34980323605](https://github.com/spikeal8-maker/asa-lab/actions/runs/34980323605) | SUCCESS; contracts и Docker/browser jobs                     |
| Scratch Documentation Routing     | [34980323518](https://github.com/spikeal8-maker/asa-lab/actions/runs/34980323518) | SUCCESS                                                      |
| ASA Lab Governance and Code Gates | [34980323588](https://github.com/spikeal8-maker/asa-lab/actions/runs/34980323588) | SUCCESS; Governance, Code, PostgreSQL/RLS и Access A browser |

Проверены conclusions и jobs через GitHub API. Эти запуски не перезапускались: нового продуктового кода в данном шаге нет. Они относятся к продуктовой ревизии выше, а не к последующему коммиту этого отчёта.

## Проверенный артефакт

- Artifact ID `10400804731`, имя `scratch-first-visible-218a7b68ed9e3c4445471187bad0646ed1e50e25`.
- ZIP SHA-256: `7101be2fdba0bcc0fffa742003413b9c8353f7af93a84a835fe9d972708541d4`; скачанный архив совпал с digest GitHub.
- `standalone/asa-commit.txt` совпадает с проверенным SHA.
- `standalone/licenses/scratch-editor-upstream.env`: version `15.1.1`, pin `82c5fea6d3e60c781f25c09b375045f9b46a43f7`.
- Это browser evidence из CI, не текущий снимок production. Артефакт имеет ограниченный срок хранения GitHub.

## Проверка требований B

| Требование                                                    | Доказательство и предел                                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Настоящий Scratch, запуск/остановка, read-only player fixture | Green main browser job; сценарии `e2e/blocks-host-storage.spec.ts`, `first-visible/*` в артефакте. Это fixtures, не durable пользовательские проекты.                                                                                                     |
| ASA logo/цвет, native Settings/File/Edit/Extensions, ru/en    | `editor.js`, `host.css`, `e2e/blocks-host-controls.spec.ts`; русский screenshot просмотрен. Forced locale отсутствует; каталог проверяется без blanket-фильтрации.                                                                                        |
| Parent-owned avatar и fullscreen                              | `BlocksEditor.tsx`, `BlocksEditorShell.tsx`, `e2e/blocks-product-integration.spec.ts`; просмотрен `product-integration/01-shipping-host-account.png`. Account response в тесте синтетический.                                                             |
| Отсутствие hidden core network fallback                       | В `first-visible/network.json` у этого SHA массивы `external` и `failed` пусты. `product-integration/network.json` содержит только origins 4612/4613; account endpoint запрашивается на parent 4612. Это не аудит production cookies или всех расширений. |
| Same-origin/non-browser guards                                | #255 интегрирован; новый main проходит focused и browser CI. Production capability/CSP/cookie policy остаётся отдельным M1-003.                                                                                                                           |
| Нет ложного сохранения                                        | `canSave: false`, controlled project fixtures и предупреждения сохранены; ASA durable save не реализован.                                                                                                                                                 |
| Читаемые служебные состояния                                  | **NEEDS_FIX, #256:** parent и child строки статуса накладываются в shipping host screenshot. Наличие правильного текста не доказывает отсутствие наложения.                                                                                               |

## Finding B-STATUS-001 / issue #256

На `product-integration/01-shipping-host-account.png` (1024×768) parent-строка `TEST · editor-ready · изменения пока не сохраняются` перекрывает child-строку `Учебный проект готов. Изменения не сохраняются.`

Прямые поверхности:

- `apps/web/src/blocks/BlocksEditor.tsx`: `.blocks-editor-preview-status`, `role="status"`.
- `apps/web/src/blocks/blocks-editor-shell.css:74-85`: absolute overlay внизу full-viewport iframe.
- `infra/scratch-editor/host/host.css:44-48`: отдельный child footer `.asa-scratch-runtime-status`.
- `e2e/blocks-product-integration.spec.ts`: проверяет текст и screenshot, но не геометрическое пересечение статусных областей.

Нужен один ограниченный ремонт статусной поверхности и regression по пересечению/дублированию. Сохранить no-save warning и обработку runtime failure; не прятать ошибки, не менять принятую шапку/редактор, не добавлять API. Проверить ready/error и применимую поверхность на 1440/1024/390/320. Screenshot review уже доказывает дефект; новая браузерная команда в этом шаге не выполнялась.

## Приёмка владельца и independent review

[Согласование владельцем внешнего вида](https://github.com/spikeal8-maker/asa-lab/pull/251#issuecomment-5680115909) сохраняется для показанных состояний. Оно не превращается в подтверждение непоказанных размеров, всех действий, сохранения или безопасности. Issue #256 требует исправления служебного дефекта, не нового дизайна.

[Независимая автоматизированная проверка #255](https://github.com/spikeal8-maker/asa-lab/pull/255#issuecomment-5681124451) относится к guard-пакету на `91884a0`; это не независимая приёмка всего B или E. Настоящий отчёт также не выдаётся за независимое заключение по собственному guard-коду автора. Полная проверка и принятие интегрированного host остаются впереди.

## Выполненные действия и границы

Локальная попытка обновить checkpoint/revision была отклонена canonical-copy validator после актуализации origin/main. Эти две собственные правки отменены и побайтно сверены с baseline. Validator не менялся и не обходился; публикация ограничена roadmap и датированным evidence-отчётом.

- GitHub snapshot: main SHA, post-merge workflows/jobs, artifact metadata и digest.
- Read-only preflight в коротком runner: `pnpm agent:recover --scope visual-programming --check` и `pnpm control-plane:check` прошли. Старый локальный origin/main не использовался как источник истины; фактический main проверен API и `git ls-remote`.
- Скачанный ZIP: проверка SHA-256, provenance, двух network JSON; просмотр реальных shipping/Russian screenshots.
- Документация: устранено старое указание на ещё не интегрированный D и не начатый B; записана фактическая необходимость ремонта. Проверенная продуктовая ревизия зафиксирована в этом датированном отчёте; исторические revisions в current.yaml не выдаются за текущий remote tip.
- Перед публикацией выполняются `pnpm gate:blocks --docs`, `pnpm control-plane:check`, проверка форматирования и `git diff --check`; окончательные результаты фиксируются в delivery receipt.

`current.yaml` не изменён: остаётся `VSCR-M1-002B / in_progress / owner_acceptance: pending`. Не добавлен альтернативный источник исполнения, не выбран 002E.

**POST_STEP_REVIEW:** документационная сверка завершена; продуктовая приёмка `NEEDS_FIX`. Ни новый runtime, ни серверные возможности в этом шаге не реализовывались. Никаких изменений JSX/CSS, библиотек, upstream pin, token protocol, БД, прав пользователей, deployment, production/TEST, backup или публичной активации.

Следующая ограниченная работа: исправить B-STATUS-001, получить focused/browser/layout evidence и затем закрыть оставшиеся условия B. Только после принятия B допустим отдельный выбор `VSCR-M1-002E`; M1-003 не начинается из этого отчёта.
