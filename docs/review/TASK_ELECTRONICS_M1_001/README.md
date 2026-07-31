# Electronics M1 owner asset checkpoint

- Task: `TASK-ELECTRONICS-M1-001`
- Branch: `agent/r4-electronics-m1`
- Review state: previous simulator presentation rejected; owner asset contact sheet pending
- Full repository matrix: `NOT_RUN` by owner directive
- Simulator work after rejection: `STOPPED`

The earlier six simulator screenshots are retained only as superseded review
history. They are not evidence of visual acceptance. The current checkpoint is
limited to restoring and presenting the owner-supplied component set before any
further simulator integration.

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

## Contact sheet contract

The deployed page `/electronics-contact-sheet.html` uses one value of
`worldUnitsPerMm` for all components. Image dimensions are derived only from
`physicalWidthMm` and `physicalHeightMm`; no per-component `renderWidth` exists.
It shows a 10 mm ruler, a common millimeter grid, source filenames, physical
dimensions, pin IDs, and terminal markers at the source coordinates. Wires and
simulation are absent.

The active M1 review subset contains eight families and all 19 recovered state
SVGs. The four-pin 6×6 mm tactile button and three-pin SPDT are represented with
their complete physical pin topology. Their previous two-terminal runtime
models remain blocked until this contact sheet is accepted and the mapping is
reconciled.

## Unaccepted current assets

All 16 files in `apps/web/public/assets/electronics/components/` lack an exact
hash match in the recovered owner archives and are excluded from the contact
sheet. The following four are explicitly self-made or otherwise unconfirmed
additions from the rejected implementation:

- `potentiometer.svg`
- `diode.svg`
- `lamp-off.svg`
- `lamp-on.svg`

The complete list and hashes are recorded in the safe public manifest. No
replacement SVG was drawn or generated during this corrective pass.
