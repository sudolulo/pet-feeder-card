#!/usr/bin/env bash
# Run a command with HA_TOKEN set from rbw (entry "${HA_TOKEN_RBW_ENTRY:?set HA_TOKEN_RBW_ENTRY}").
# The token travels only via the environment, never argv or a file.
set -euo pipefail
HA_TOKEN="$("$HOME/.cargo/bin/rbw" get "${HA_TOKEN_RBW_ENTRY:?set HA_TOKEN_RBW_ENTRY}")"
export HA_TOKEN
exec "$@"
