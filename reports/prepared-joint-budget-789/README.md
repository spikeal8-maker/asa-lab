# SIZE_VERIFICATION_ONLY_NOT_READY

Frozen composition on main `10dddd83782d2c906932500c953e25b930fb27ff`.

- A: `b4c723b30abc5fa8e77b162fc27ccca59c2793f8`, original base `d9e747ebf6397e8ef8e54515c6b83e0a6d709c08`.
- B: `e4d3712d1db47aeb762bc9401781257bd4b66ad0`, original base `00003a3832383356ac863d838498d65eed714b3d`.
- C: preserved NOT_READY `307f18d98d309add057e150bd90e66365352801f`, original base `0e96139d26f8865c3a5441223caf842f60aa671c`.

`composition.json` records all 18 exact Git blobs, original-base and main entries. All paths passed the no-foreign-overlap guard; all 18 checked-out blobs match their frozen source. The canonical generated coverage JSON comes from A unchanged. Old evidence/reports remain at the frozen refs and were not copied. No task card or current.yaml changes.

Exactly one `NX_SKIP_NX_CACHE=true pnpm nx run web:build --skip-nx-cache`: PASS, 7 fresh Nx tasks, cache skipped, duration 42.4s. Then the unchanged `node tools/check-web-bundle-budget.mjs`: FAIL, Arduino **2000004/2000000 bytes**, over by **4 bytes**. Other seven fixed caps PASS. Exact asset names and measurements are in bundle-caps.log; build-exit.txt=0, caps-exit.txt=1.

STOP at the prescribed budget boundary. No adjustment, minification, extraction, cap increase, new implementation, dependency/workflow/inventory edits, or additional build/gate. Runtime, browser, AVR, native, focused/full canonical proof, independent acceptance and owner acceptance: NOT_RUN for this composition. The modified public-worker allowlist is out of scope; any future-proof update remains pending. This probe does not complete prepared work or establish runtime acceptance. Priority mirror CI remains untouched. No main integration, server, Docker, database, ports or protected assets action.
