#!/usr/bin/env bash
# шим: sources-loop → універсальний wl-loop
exec "$(dirname "$0")/wl-loop.sh" sources "$@"
