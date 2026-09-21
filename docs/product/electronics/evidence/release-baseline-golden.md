# Benchmark receipt drift classification

Independent read-only comparison executed all 50 corpus cases at historical
golden revision `45f0ba34` and integrated revision
`eb7204267b21c11fb9201c95020ddc6a2d4b44cc`. Every historical case reproduced its
committed hash before comparison. No solver code was changed for this repair.

| Cases | Observed difference |
| --- | --- |
| 6 | Byte-identical results |
| 37 | Only the global modelSetDigest |
| 2 Arduino analyses | Model and simulation input digests |
| 4 Arduino clock cases | Added loadedSource and changed document digest |
| 1 tone analysis | Intended controller event and phase-state changes |

Electrical numeric results are unchanged across all 50 cases. The model identity
registry expanded for HC-SR04 (`b31c135d`), Servo (`d1f90203`), PIR (`b01093c7`)
and PING (`0bbb6bab`). Commit `a367850b` excludes editor source from the simulation
digest; `92c6a54d` preserves the last-good loaded program. Commit `6fc686fb` makes
tone select OUTPUT, reset phase and emit each tone-start event. The tone case is
therefore a real intended runtime change, not metadata-only drift.

For dc-series-1, substituting only the prior modelSetDigest into the current
result reproduces the original fingerprint exactly. This identifies the cause;
the test itself continues to hash the entire unmodified result.

Regenerate the current receipt with the existing explicit-accept generator:
44 fingerprints change, six remain identical, case IDs and statuses stay intact.
The historical receipt remains in Git at the revision above. No assertion is
removed or weakened. Validate the corpus, tone waveform, runtime state and
scheduler regressions before publishing the repair.
