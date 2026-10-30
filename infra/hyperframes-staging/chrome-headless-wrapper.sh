#!/bin/sh
# Staging-only and synthetic-only. The entire container must use:
# --network none, --read-only, --cap-drop ALL, --security-opt no-new-privileges,
# explicit memory/CPU/PID ceilings and an ephemeral /tmp.
#
# Chrome's own Linux namespace sandbox is unavailable under those strict
# container settings. Disable only Chrome's nested sandbox; do not loosen
# the outer container isolation. DO NOT use with customer HTML/media until
# the production sandbox, RLS, key custody and security review are complete.
exec /usr/local/bin/hf-pinned-browser \
  --no-sandbox \
  --disable-setuid-sandbox \
  --disable-dev-shm-usage \
  "$@"
