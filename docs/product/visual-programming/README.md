# Visual Programming / Scratch — agent router

Execution state: `pnpm agent:context --scope visual-programming` reads `docs/execution/current.yaml`.
Product work starts only after the owner selects it. Stop when the selected bounded request is complete.

## Owner change: default access, 2026-09-16

Владелец выбрал [VSCR-M4-002](tasks/VSCR-M4-002.md): настоящий Scratch
доступен всем в режиме локальных файлов, без preview-скрытия. Порядок разработки
серверного хранения и проверки B/E не отменён и не объявлен завершённым.
Старые требования скрывать весь редактор до M4-001 заменены этим решением.

## Canonical precedence — защита от старого ТЗ

Если старый issue, ветка, комментарий, архивный отчёт или task snapshot противоречит актуальному `main`, бот **не имеет права** брать старое требование как product truth.

Порядок источников:

```text
1. docs/execution/current.yaml                    # что выполняется сейчас
2. tasks/<selected-task>.md                       # точное ТЗ выбранного шага
3. components/*.yaml + mapped D0 heading          # контракт компонента
4. ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md  # стабильные invariants
5. forward plan                                   # readiness/order only
6. GitHub issue / старые ветки / исторические отчёты = только история
```

При конфликте STOP → исправить routing/docs → только потом кодировать.

Для текущего product-shell решения действует простой invariant:

```text
Scratch остаётся настоящим Scratch
Settings/File/Edit/Extensions не переписываются ради брендинга
встроенный язык остаётся внутри Scratch Settings
штатные внешние service/hardware integrations не удаляются blanket-фильтром
ASA меняет product logo, product colour и parent-owned avatar/account
```

## Read only the selected concern

```text
START_HERE_FOR_AI.md
→ this router
→ tasks/<selected-task>.md
→ named component in components/*.yaml
→ mapped D0 heading
→ source + tests
```

`COMPONENT_MAP.yaml` используется только когда компонент неизвестен. Не загружать master/ADR/all D0/all tasks по умолчанию.

## Checks

```bash
pnpm gate:blocks
pnpm gate:blocks --browser
pnpm gate:blocks --docs
pnpm gate:blocks --list
```

Cumulative runner: `tools/blocks/gate.mjs`. Extend existing Scratch gate instead of adding per-slice root scripts. Full API/Web integration remains in `pnpm gate:repository`.

## References when needed

| Question                  | Source                                                          |
| ------------------------- | --------------------------------------------------------------- |
| Next capability/readiness | `VSCR-M1-FORWARD-PLAN-2026-09-11.md`                            |
| Ownership/review guidance | `AGENT_GUIDE.md`                                                |
| Unknown component         | `COMPONENT_MAP.yaml`                                            |
| Product goal/invariants   | `../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`              |
| Architecture decision     | `../../architecture/ADR-VSCR-001-SCRATCH-EDITOR-INTEGRATION.md` |

Preserve exact upstream pin and accepted parent/iframe boundary. Scratch GUI/VM stays outside `apps/web` dependencies. New upstream patches require explicit reviewed need. Deployment/activation require separate owner instruction.
