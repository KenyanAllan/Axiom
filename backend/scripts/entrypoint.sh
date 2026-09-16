#!/usr/bin/env bash
set -euo pipefail

case "${1:-api}" in
  api)
    echo "Running database migrations..."
    alembic upgrade head
    echo "Starting API server..."
    exec uvicorn app.main:app \
      --host 0.0.0.0 \
      --port 8000 \
      --workers "${UVICORN_WORKERS:-2}" \
      --log-level "${LOG_LEVEL:-info}"
    ;;

  worker)
    echo "Starting Celery worker..."
    exec celery -A app.workers.celery_app worker \
      --loglevel="${LOG_LEVEL:-info}" \
      --concurrency="${CELERY_CONCURRENCY:-2}" \
      -Q ingestion,default
    ;;

  migrate)
    echo "Running database migrations..."
    exec alembic upgrade head
    ;;

  seed)
    echo "Running database seed..."
    alembic upgrade head
    exec python -m scripts.seed
    ;;

  *)
    exec "$@"
    ;;
esac
