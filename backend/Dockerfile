FROM python:3.11-slim

WORKDIR /app
ENV PYTHONPATH=/app

# System deps for psycopg2, asyncpg builds
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev curl && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run migrations on startup is handled by the api service entrypoint in dev.
# For prod, run: alembic upgrade head as a pre-task.
EXPOSE 8000
