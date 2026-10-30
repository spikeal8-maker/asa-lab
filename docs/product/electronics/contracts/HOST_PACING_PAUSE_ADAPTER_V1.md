# Host pacing and pause adapter v1

This adapter changes wall-to-model demand and presentation playback only.
The canonical clock contract §§8–9, timed engine API, solver steps, Arduino
instruction time, delay/millis, thermal integration and quality limits remain
unchanged. The requested rate is session state, never project document data.

## Rates and authority

Rates are zero, 0.1–0.9, 1 and integer 2–10. Zero requests pause; negative
physical time is not supported. The untouched default ×1 route retains its
previous requests, callbacks, continuations and presentation frames byte for
byte. A changed positive rate uses a piecewise wall/model anchor; accepted
canonical C and acknowledged presentation P remain monotonic with P <= C.

One rate drives host demand and both presentation/native preparation paths.
Generic profiles publish actual complete endpoints; the adapter invents no
event history. A requested ×10 is demand, not a guarantee of compute throughput.

## Pause boundary

Requesting zero immediately blocks every positive controller dispatch, including
queued inputs and yielded continuations. A single already dispatched advance
may finish in the Worker, but its entire response is held unaccepted: no new C,
Serial projection or result is published. Preflight and the complete initial H0
observation are allowed so zero selected before Run can initialize correctly.

An already proposed presentation frame retains its exact token, native leases
and existing joint DOM/native-image ACK. During `pausing`, that frame may settle;
no replacement frame is prepared. Only after this boundary is settled is the
adapter `paused`. An image callback alone cannot commit a cursor. While paused,
canonical state, acknowledged vector, generation and Serial remain frozen.

## Resume, transitions and input

Resume accepts the held response once before dispatch resumes. It reanchors host
time at the accepted C and presentation time at acknowledged P, using the current
rate. Wall time spent paused does not become demand. Explicit rate transitions
discard obsolete ordinary wall demand while retaining input, continuation and
pending source synchronization. Late accepted responses and old proposed-frame
ACKs reanchor with the latest rate; they cannot restore an obsolete rate or
backdate either cursor.

Physical and Serial input received while paused stays queued. Existing input
retiming places it after the final accepted C, preserving order and spacing.
Stop, dispose, reset and structural generation replacement discard any held
old-generation response through existing generation ownership. They cannot
publish its Serial or revive it on resume.

Evidence belongs to the bounded speed task. The adapter must not replace missing
model results with invented poses or certify unrelated model capabilities.
