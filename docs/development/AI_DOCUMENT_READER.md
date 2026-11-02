# Document extraction in a source API build

`pnpm exec nx run api:build` compiles the API and copies the trusted
`document-reader.py` beside the compiled reader in `apps/api/dist/ai-attachments`.
`api:serve` uses this same build target. The copy tool is part of the Nx build input.

The host must provide Python with the exact dependencies in
`tools/ai-document-requirements.txt`. Provision these in an installation-owned
virtual environment; the API never installs dependencies itself.

`ASA_DOCUMENT_PYTHON` optionally selects one trusted executable, preferably an
absolute path to that virtual environment's Python. It is server configuration,
never a request parameter. Supply a path only, without quotes or command-line
arguments. The reader invokes it directly with `shell: false` and Python `-I`.
Without this variable, Windows uses `python` and Linux/macOS use `python3` from
the trusted service PATH. Docker sets it to its existing
`/opt/asa-document-python/bin/python` virtual environment.

After the normal API build, `node tools/smoke-ai-built-document-reader.mjs`
reads the repository's real PDF, DOCX and XLSX fixtures through the compiled
JavaScript entry point and rejects the scanned PDF. The focused AI workflow
runs this outside Docker with a temporary CI virtual environment and the same
pinned requirements used by Docker.

The existing input, output, concurrency and 15-second extraction limits remain
in force. Missing Python/dependencies, invalid documents and cancellation fail
closed; they do not return filenames as extracted document content.
