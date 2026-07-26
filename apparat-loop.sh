#!/usr/bin/env bash
# шим: apparat-loop → універсальний wl-loop
exec "$(dirname "$0")/wl-loop.sh" apparat "$@"
