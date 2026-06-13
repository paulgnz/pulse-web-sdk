#!/usr/bin/env bash
# Serve the demo over http so the pulsevm:// callback has a real origin to return to.
cd "$(dirname "$0")"
echo "▸ Pulse Wallet demo → http://localhost:8000"
python3 -m http.server 8000
