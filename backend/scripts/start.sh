#!/bin/bash
set -e

echo "Running database migrations..."
alembic upgrade head

echo "Seeding demo data..."
python -m scripts.seed

echo "Starting API server..."
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --reload \
  --log-level debug
