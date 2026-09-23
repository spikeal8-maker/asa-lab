# Arduino runtime growth review

Reviewed source: `contexts/electronics/domain/arduino-program-runtime.ts`, 84,928
tracked bytes, previously 68,170 (24.6% growth). The 20% review trigger remains.

The intervening implementation history adds resumable pulseIn, deterministic
Serial TX/RX, timed tone, Servo and the ultrasonic adapter. The file still owns
source parsing/compilation, typed variable scopes, statement execution and the
resumable instruction loop. The public boundaries remain syntax analysis,
state/program matching, snapshot/clocked advancement, reset and input-read detection.

The Serial and Servo member-statement dispatchers are separable responsibilities;
parsing and resumable execution are coupled through compiled instructions and
RuntimeState. Keep the `decomposition-candidate` classification. A future extraction
must preserve timing, diagnostics, state serialization and direct/clocked parity;
splitting by byte count during release repair would not establish that evidence.

The legacy-ms-v1 bridge is still used by snapshot callers. Its existing retirement
condition remains, and no production source or protected/historical evidence is
removed in this review. This is a bounded growth review, not acceptance of all
recent peripheral capabilities or completion of the optimization roadmap.
