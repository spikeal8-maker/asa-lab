#!/bin/sh
set -eu

# GitHub-only public-mode smoke with localhost names: no real domain and no ACME rate-limit.
# Exercise the real Web/Caddy image, including HTTPS, www and durable TLS storage.
container=asa-ci-public-caddy
volume=asa-ci-public-certificates
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || :
  docker volume rm "$volume" >/dev/null 2>&1 || :
}
trap cleanup EXIT INT TERM
cleanup
docker volume create "$volume" >/dev/null
docker run --detach --name "$container" \
  --read-only --tmpfs /tmp \
  --sysctl net.ipv4.ip_unprivileged_port_start=0 \
  --publish 127.0.0.1:10443:443 \
  --env ASA_PUBLIC_DOMAIN=example.localhost \
  --env ASA_BLOCKS_RUNTIME_ORIGIN=https://example.localhost \
  --env XDG_DATA_HOME=/var/lib/asa-caddy \
  --volume "$volume":/var/lib/asa-caddy \
  asa-lab-web:ci >/dev/null

wait_for_tls() {
  count=0
  while [ "$count" -lt 30 ]; do
    status=$(curl --noproxy '*' --silent --insecure --output /dev/null \
      --write-out '%{http_code}' --resolve example.localhost:10443:127.0.0.1 \
      'https://example.localhost:10443/' || :)
    if [ "$status" = "200" ]; then return 0; fi
    count=$((count + 1))
    sleep 1
  done
  docker logs "$container" >&2 || :
  echo 'HTTPS did not return a successful page.' >&2
  exit 1
}
wait_for_tls

headers=$(curl --noproxy '*' --silent --show-error --insecure --head \
  --resolve www.example.localhost:10443:127.0.0.1 \
  'https://www.example.localhost:10443/sample?x=1' | tr -d '\r')
printf "%s\n" "$headers" | grep -Eq "^HTTP/[0-9.]+ 308"
printf "%s\n" "$headers" | grep -Eiq "^location: https://example.localhost/sample\\?x=1$"

# The Web user writes the certificate store, and it survives a restart.
certs=$(docker exec "$container" sh -c 'find /var/lib/asa-caddy -type f -name "*.crt" | wc -l')
if [ "$certs" -lt 1 ]; then echo "No persisted Caddy certificates" >&2; exit 1; fi
docker restart "$container" >/dev/null
wait_for_tls
echo 'PUBLIC_CADDY_SMOKE PASS: same Web image, TLS, www redirect, persisted certificate and restart'
