# NPN cache exclusion BEFORE

Captured on unmodified product baseline `1b4ba64fe7680ab1a22d63c9d3a1433c63deeb66`.
The private probe uses the actual four-display NPN circuit and scalar-helper
counter source, fixed 25000 us horizon, 256-event quantum, production owned
request factory with both optical observers enabled. Helper source correctly
uses the public runtime fallback; no GPIO/brightness/digits are injected.

After one warm-up, two executions took 1472.8803 and 1242.6256 ms wall time.
Each reached READY through three scheduler quanta, making 1383 algebra lookup
calls and zero cache hits. These are baseline measurements, not ABBA results.
The full frames include results, continuation states, events, diagnostics and
optical histories; deterministic serialized payload is 84612 bytes with SHA256
`4eb3758a71405065b0bdf6eea0f1d2c32c3a9f22e3f0cf87d11eaf31f0aee2cd`.
The esbuild instrumentation is private test tooling only; no production source
was edited. Cache exclusion is proven; beneficial exact reuse still needs proof.
