#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if [ ! -d venv ]; then
  python3 -m venv venv
  source venv/bin/activate
  pip install -r requirements.txt
else
  source venv/bin/activate
fi
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env — edit TWELVE_DATA_API_KEY before production use"
fi
exec python main.py
