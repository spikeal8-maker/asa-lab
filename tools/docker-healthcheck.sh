#!/bin/sh
set -eu

base_url=${ASA_BASE_URL:-http://127.0.0.1:4610}
output=${1:-reports/docker-health.json}
tmp_file="${output}.tmp"

mkdir -p "$(dirname "$output")"

live=$(curl --fail --silent --show-error "${base_url}/health/live")
ready=$(curl --fail --silent --show-error "${base_url}/health/ready")
web_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "${base_url}/")

jq -n \
  --arg baseUrl "$base_url" \
  --arg webStatus "$web_status" \
  --argjson live "$live" \
  --argjson ready "$ready" \
  '{
    status: (if $webStatus == "200" and $live.status == "live" and $ready.status == "ready" then "PASS" else "FAIL" end),
    baseUrl: $baseUrl,
    webStatus: ($webStatus | tonumber),
    live: $live,
    ready: $ready
  }' >"$tmp_file"

mv "$tmp_file" "$output"
jq -e '.status == "PASS"' "$output" >/dev/null
printf 'Docker health PASS: %s\n' "$output"
