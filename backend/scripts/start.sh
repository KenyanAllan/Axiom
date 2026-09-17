#!/bin/bash
export PYTHONPATH=/app:${PYTHONPATH}

if [[ "${DATABASE_URL}" == *"localhost:5432"* ]] || [ -z "${DATABASE_URL}" ]; then
  echo "Localhost PostgreSQL specified without local DB server. Using SQLite..."
  export DATABASE_URL="sqlite+aiosqlite:////tmp/axiom.db"
  export SYNC_DATABASE_URL="sqlite:////tmp/axiom.db"
fi

echo "Running database migrations..."
alembic upgrade head || echo "Warning: Migration failed or skipped."

echo "Seeding demo data..."
python -m scripts.seed || echo "Warning: Seeding failed or skipped."

echo "Starting API server..."
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 1 \
  --log-level info

