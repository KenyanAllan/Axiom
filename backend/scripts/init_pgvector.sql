-- Runs once on first container start.
-- The pgvector/pgvector:pg16 image ships the extension; we just enable it.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
