#!/usr/bin/env bash
# Serve the static web checkout (index.html + done.html) for LOCAL pay-rail testing.
#
# Binds 0.0.0.0:8080 so the Android emulator can reach it at http://10.0.2.2:8080 (10.0.2.2 = the
# host machine as seen from the emulator). The app opens .../index.html with the buyer's session in
# the URL fragment; YooKassa returns the browser to .../done.html (BILLING_RETURN_URL).
#
# Usage:  ./serve.sh            # port 8080
#         PORT=9000 ./serve.sh  # override
# Stop with Ctrl-C. Static files only — no build, no backend here. See RUNBOOK-local-test.md.
set -euo pipefail

PORT="${PORT:-8080}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Serving $DIR on http://0.0.0.0:$PORT  (emulator → http://10.0.2.2:$PORT/index.html)"
echo "Ctrl-C to stop."
# Python's http.server is in every dev env; --bind 0.0.0.0 is the key bit for emulator reachability.
exec python3 -m http.server "$PORT" --bind 0.0.0.0 --directory "$DIR"
