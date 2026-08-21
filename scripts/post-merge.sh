#!/usr/bin/env bash
set -euo pipefail

python3 -m py_compile server.py
node --check script.js