#!/bin/sh
set -eu
# Environment expansion happens before Caddyfile parsing. Accept only CIDR
# tokens, so a value cannot inject Caddy directives. Caddy validates the IPs.
proxy_cidrs=${ASA_INGRESS_TRUSTED_PROXY_CIDRS:-127.0.0.1/32 ::1/128}
[ "${#proxy_cidrs}" -le 2048 ] || exit 78
printf '%s\n' "$proxy_cidrs" | grep -Eq '^[A-Fa-f0-9:./ ]+$' || {
  echo 'Invalid ASA_INGRESS_TRUSTED_PROXY_CIDRS: explicit space-separated CIDRs required.' >&2
  exit 78
}
proxy_count=0
for cidr in $proxy_cidrs; do
  proxy_count=$((proxy_count + 1))
  printf '%s\n' "$cidr" | grep -Eq '^[A-Fa-f0-9:.]+/[0-9]+$' &&
    ! printf '%s\n' "$cidr" | grep -Eq '/0+$' || exit 78
done
[ "$proxy_count" -ge 1 ] && [ "$proxy_count" -le 16 ] || exit 78
export ASA_INGRESS_TRUSTED_PROXY_CIDRS="$proxy_cidrs"
panel_peer=${ASA_PANEL_INGRESS_PEER:-127.0.0.1}
case "$panel_peer" in
  *[!0-9.]*|'') echo 'Invalid ASA_PANEL_INGRESS_PEER: one IPv4 address is required.' >&2; exit 78 ;;
esac
printf '%s\n' "$panel_peer" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || {
  echo 'Invalid ASA_PANEL_INGRESS_PEER: one IPv4 address is required.' >&2
  exit 78
}
export ASA_PANEL_INGRESS_PEER="$panel_peer"
origin=${ASA_BLOCKS_RUNTIME_ORIGIN:-}
if [ -n "$origin" ]; then
  printf '%s\n' "$origin" | grep -Eq '^https?://([A-Za-z0-9.-]+|\[[A-Fa-f0-9:]+\])(:[0-9]{1,5})?$' || {
    echo 'Invalid ASA_BLOCKS_RUNTIME_ORIGIN: an exact HTTP(S) origin is required.' >&2
    exit 78
  }
fi
printf 'globalThis.__ASA_RUNTIME_CONFIG__={"blocksRuntimeOrigin":"%s"};\n' "$origin" > /tmp/runtime-config.js
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
