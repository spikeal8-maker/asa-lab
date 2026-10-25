---
task_id: TASK-ELECTRONICS-ANALOG-SERIAL-001
kind: repair
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Analog inputs, real Serial Monitor and disconnected ADC observations

Owner requests this AFTER toolbar761: A0-A5 must measure actual potentiometer,
resistor/divider, diode and four-button resistor-ladder circuits and print correct
values in the real Serial Monitor. Disconnected inputs should vary rather than
pretend a measured zero. Read-only inventory found connected analog/Serial paths
already present; produce actual failing BEFORE before repairing that path.

Allowed production: arduino-program-runtime.ts, arduino-circuit-scheduler.ts and
solver.ts in contexts/electronics/domain, narrowly necessary existing preparation/
observation type owner; ArduinoSerialMonitor.tsx only for a demonstrated display
defect. One small ADC observation helper allowed if essential new feature logic,
not file redistribution. Supporting runtime/scheduler/Worker/monitor tests and
one actual native Worker-to-monitor fixture. No general parser/solver/Serial
refactoring, physics equations, dependencies/workflows/assets/schema changes.
Return concise cause/proposal BEFORE product edits; controller narrows scope.

Connected inputs remain measured relative to board ground/reference. Cover all
six aliases/numeric selectors, ground0, supply1023, divider/wiper intermediate
codes, timed wiper/button changes and diode voltage, prints matching actual
canonical solver voltage conversion. Actual Worker->serial projection->real
ArduinoSerialMonitor desktop1440/mobile390, close/reopen/clear/Stop/Run/Reset/
source switch and board isolation; do not prove only core values while display
can hide new serial generations. Preserve TX/RX and bounded history semantics.

Floating ADC is a DECLARED deterministic educational observation model, not a
prediction of ambient interference. Official Arduino reference confirms floating
readings vary but defines no waveform:
https://github.com/arduino/reference-en/blob/master/Language/Functions/Analog%20IO/analogRead.adoc
Owner's explicit request authorizes this model; no repeat permission required.
Never perturb solved voltages/current/residuals or insert generated ADC counts in
numeric terminalVoltages. Program output decisions caused by modeled ADC reads
still pass through the normal solver. No Math.random, wall clock or global RNG.

Classify conservatively unconnected INPUT nets using actual prepared terminal
nodes: only board INPUTs and dangling wires/breadboard contacts, without external
components, supply/ground, OUTPUT or INPUT_PULLUP. A0-A1 dangling wire is floating;
grounded A0 is measured0. Existing solver numerical islands join all Uno pins and
GMIN makes an unconstrained pin zero: neither islands nor voltage==0 prove floating.
Do not expand this slice into arbitrary impedance/charge inference for every
passive/open-switch topology; document the classification boundary honestly.

Attach optional transient ADC observation metadata to the real input sampling
route (eager/lazy/owned paths), without changing normal numeric entries, electrical
result protocol or persisted runtime version. Pure fixed integer mixing of stable
board/pin identity and canonical sample time (document fixed1ms bucket) yields
finite integer0..1023 for classified unconnected inputs. Same coordinates repeat;
different sample times vary. No cursor/state-version change, hidden random seed,
advance-dependent classification, locale hash or incompatible saved-state change.
Legacy raw numeric input calls without physical observation context retain their
defined behavior; don't infer disconnection from missing voltage alone.

Required golden connected-circuit/printed-code and UI BEFORE/AFTER evidence;
floating finite range/variation/repeatability, grounded/pullup/output suppression,
wire/breadboard nets, recorded connect/disconnect transitions; exact single/split
advance, budget1/7, JSON continuation, direct/actual Worker parity. Electrical
observations stay byte-identical when ADC affects only Serial. Preserve loops1,
diagnostic coordinates5, digital A0-A5/output18 and legacy Blockly/projects.

Fresh NX_SKIP_NX_CACHE=true gate:electronics-m1, relevant lint/format/types/build,
fixed bundle222000/2000000 and NEW independent exact-final-SHA review. No cap raise
or cleanup to fit; report measured blocker. Native uses real Worker and real
monitor; explicit controller ports are not full installed app or server SaveCAS.
One bounded candidate, final convergence/review then STOP. General/release/
installed/owner acceptance separate. No foreign CI repair, paused682 experiments,
Docker/server/liveDB/deployment, tenant changes or protected owner assets.
