#!/bin/sh
set -eu
origin=${ASA_BLOCKS_PARENT_ORIGIN:-}
if [ -n "$origin" ]; then
  printf '%s\n' "$origin" | grep -Eq '^https?://([A-Za-z0-9.-]+|\[[A-Fa-f0-9:]+\])(:[0-9]{1,5})?$' || {
    echo 'Invalid ASA_BLOCKS_PARENT_ORIGIN: an exact HTTP(S) origin is required.' >&2
    exit 78
  }
  sed "s#<meta name=\"asa-parent-origin\" content=\"[^\"]*\" />#<meta name=\"asa-parent-origin\" content=\"$origin\" />#" \
    /usr/share/nginx/html/index.html > /var/cache/nginx/asa-index.html
else
  cp /usr/share/nginx/html/index.html /var/cache/nginx/asa-index.html
fi
exec nginx -g 'daemon off;'
