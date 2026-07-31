# Electronics M1 production editor checkpoint

- Task: `TASK-ELECTRONICS-M1-001`
- Branch: `agent/r4-electronics-m1`
- Review state: production assets integrated into the real Electronics editor; owner visual review pending
- Full repository matrix: `NOT_RUN` by owner directive
- R4-M2: `NOT_STARTED`

The owner archive audit at `9654ce3` remains immutable reference evidence. The
current delivery result is the actual project editor, not a standalone review
page. New projects use the production manifest; legacy assets remain available
only for existing documents.

## Real editor evidence

Project: `Electronics production integration`

The project contains 14 production components, a 420-hole breadboard, three
wires and immutable checkpoint 1. Reload restored the component types, variants,
state, positions, breadboard hole bindings and connections. A connected
2×AA-resistor-LED loop reports 0.2 mA; the 4.7 kOhm resistor inspector reports
3.000 V, 2.002 V, 0.21 mA and 0.998 V drop.

| Evidence | Purpose |
| --- | --- |
| `library-production.png` | Production-manifest library in the actual editor |
| `breadboard-empty.png` | 420-hole breadboard with 2.54 mm internal groups |
| `breadboard-components-snapped.png` | LED and four-pin tactile button snapped to stable hole IDs |
| `led-rgb-display-states.png` | RGB controls plus displays 0, 8, A and arbitrary mask |
| `connected-running.png` | Live connected circuit and 0.2 mA result |
| `reload-checkpoint.png` | Reloaded 4.7 kOhm resistor, voltages/current and checkpoint 1 |

Focused checks cover the manifest adapter, schema migration, physical scale,
production pins, breadboard connectivity, state persistence and the actual
editor journey. The full repository matrix was intentionally not run.

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
