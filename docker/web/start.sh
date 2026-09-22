#!/bin/sh
set -eu
origin=${ASA_BLOCKS_RUNTIME_ORIGIN:-}
if [ -n "$origin" ]; then
  printf '%s\n' "$origin" | grep -Eq '^https?://([A-Za-z0-9.-]+|\[[A-Fa-f0-9:]+\])(:[0-9]{1,5})?$' || {
    echo 'Invalid ASA_BLOCKS_RUNTIME_ORIGIN: an exact HTTP(S) origin is required.' >&2
    exit 78
  }
fi
printf 'globalThis.__ASA_RUNTIME_CONFIG__={"blocksRuntimeOrigin":"%s"};\n' "$origin" > /tmp/runtime-config.js
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
