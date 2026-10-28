#!/bin/sh
set -eu
# Exercise writable container state absent from the base image and host binds.
printf 'api-review-compiled-state\n' > /workspace/review-writable-marker
cd /app
exec node /workspace/apps/api/src/main.js
