# Electronics M1 owner-reference presentation checkpoint

- Task: `TASK-ELECTRONICS-M1-001`
- Branch: `agent/r4-electronics-m1`
- Review state: owner-reference visual candidate in the real Electronics editor; owner acceptance pending
- Full repository matrix: `NOT_RUN` by owner directive
- R4-M2: `NOT_STARTED`

The owner archive audit at `9654ce3` remains immutable reference evidence. The
current delivery result is the actual project editor, not a standalone review
page. New projects use the production manifest through a deterministic family
adapter; legacy assets remain available only for existing documents.

## Real editor evidence

Project: `Electronics owner visual parity`

At 100% zoom the default `Основные` shelf is 330 px wide and presents the exact
owner-defined 15-card order in three columns. Cards contain only the component
image and name. Unsupported preview cards are visibly disabled, non-draggable
and cannot create document components. The canvas checkpoint contains the small
breadboard plus resistor, LED, four-pin button and three-pin SPDT. Terminal
markers remain hidden while idle and appear only for hover or active wiring;
pins bound to breadboard holes do not receive duplicate markers.

| Evidence | Purpose |
| --- | --- |
| `editor-idle-clean.png` | Clean 100% canvas without selection, pending wire or diagnostics |
| `library-basic-three-columns.png` | 330 px `Основные` shelf with three columns |
| `library-basic-exact-order.png` | Exact owner-defined order of all 15 Basic cards |
| `component-hover-terminal.png` | Small terminal markers shown only on component hover |
| `wiring-mode-terminals.png` | Terminal markers and pin labels shown during active wiring |
| `component-selected.png` | Calm selected-component state and inspector without idle pin labels |
| `breadboard-placement-clean.png` | Small breadboard and four components on a clean canvas |
| `library-disabled-components.png` | Unsupported cards disabled, non-draggable and vector-only |
| `owner-reference-vs-current.png` | Side-by-side 100% owner reference and current visual candidate |

Focused checks cover the manifest adapter, categories, exact family ordering,
safe preview cards, physical scale, production pins, contextual terminal
visibility, breadboard connectivity and the actual editor journey. The focused
Playwright collector reports zero console errors, page errors, failed requests
and HTTP 5xx responses. The full repository matrix was intentionally not run.
This evidence is a candidate for owner visual review and is not an acceptance
record.

## Owner archive recovery

Two owner-supplied archives were found. The originals were not modified and the
private ZIP files are not committed to Git.

| Archive | SHA-256 | Files | Verified local backup |
| --- | --- | ---: | --- |
| `Компоненты.zip` | `c7b0fb2e541ed740b160aa9c84458b5951d0140afbce4f95c4c06eba20ec836e` | 1476 | `/home/spike/backups/owner-supplied-electronics-components-20260731T152248Z.zip` |
| `Electro-venik-reference-lab.zip` | `36c13aca5f60e4a048e788ff1826707db7355287c3731a37e4866cd2fca48ea7` | 749 | `/home/spike/backups/owner-supplied-electronics-reference-lab-20260731T152727Z.zip` |

Every file in both archives was hashed independently: 2225 files total. The
entry inventories are stored beside the backups and are also excluded from Git.

## Search coverage

The recovery search checked the required locations and followed the discovered
project provenance into OneDrive:

- `/home/spike/`
- `/home/spike/backups/`
- `/home/spike/work/`
- `/mnt/c/Users/spike/Downloads/`
- `/mnt/c/Users/spike/Documents/`
- `/mnt/c/Users/spike/Desktop/`
- `/mnt/c/Users/spike/.codex/`
- `/mnt/c/Users/spike/AppData/Local/`
- `/mnt/c/Users/spike/OneDrive/Project/`

Windows denied reading two unrelated protected folders during the broad scan:
`AppData/Local/Kaspersky Lab/Kaspersky Password Manager` and
`AppData/Local/ElevatedDiagnostics`. One unrelated Desktop documentation folder
returned an I/O error. None is the provenance location of the recovered archives.

## Preserved reference contract

The archived contact sheet uses one value of
`worldUnitsPerMm` for all components. Image dimensions are derived only from
`physicalWidthMm` and `physicalHeightMm`; no per-component `renderWidth` exists.
It shows a 10 mm ruler, a common millimeter grid, source filenames, physical
dimensions, pin IDs, and terminal markers at the source coordinates. Wires and
simulation are absent.

The four-pin 6×6 mm tactile button and three-pin SPDT retain their complete
physical pin topology in both the reference evidence and the production editor.

## Unaccepted current assets

All 16 files in `apps/web/public/assets/electronics/components/` lack an exact
hash match in the recovered owner archives and are legacy-only. The following
four remain explicitly self-made or otherwise unconfirmed additions from the
rejected implementation:

- `potentiometer.svg`
- `diode.svg`
- `lamp-off.svg`
- `lamp-on.svg`

The complete list and hashes are recorded in the safe public manifest. No
replacement SVG was drawn or generated during this corrective pass.
