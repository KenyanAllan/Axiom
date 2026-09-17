# Axiom — AWS Deployment Checklist

## 1. AWS Account & IAM

- [ ] Create (or confirm) an AWS account with billing enabled
- [ ] Create an **ECS Task Execution Role** (or EC2 instance role) for the backend with these managed policies:
  - `AmazonBedrockFullAccess`
  - `AmazonS3FullAccess` (scope down to `axiom-*` buckets in production)
  - `AmazonTranscribeFullAccess`
  - `AmazonPollyFullAccess`
  - `AmazonRDSDataFullAccess` (or scoped to your Aurora cluster)
- [ ] If **not** using IAM roles (e.g., running on a plain EC2), generate `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` — store in `.env`, never commit
- [ ] Set default region: `us-east-1` (must match Bedrock model availability)
- [ ] **Note:** When using IAM task/instance roles, leave `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` unset — boto3 auto-discovers credentials from the role. This is the preferred pattern.

## 2. Amazon Aurora Serverless v2 (PostgreSQL + pgvector)

- [ ] Create an Aurora Serverless v2 cluster — engine **PostgreSQL 16**
- [ ] Set master username/password — use strong credentials (not `axiom` / `axiom_dev_secret`)
- [ ] Set min capacity to **0.5 ACU**, max to **2 ACU** (keeps costs low for demo)
- [ ] Place in a VPC + security group that allows inbound on port `5432` from your backend EC2/ECS only
- [ ] **Enable SSL/TLS** — Aurora enforces SSL by default, but verify `rds.force_ssl=1` in the parameter group
- [ ] Connect and enable the pgvector extension:
  ```sql
  CREATE EXTENSION IF NOT EXISTS vector;
  ```
- [ ] **Run Alembic migrations** (first deploy only, then on each schema change):
  ```bash
  alembic upgrade head
  ```
- [ ] **Known issue:** Migration 001 creates embedding columns as `FLOAT[]` but the ORM uses `Vector(1024)`. If starting fresh, the seed/init handles this. If upgrading, you may need a manual `ALTER COLUMN ... TYPE vector(1024)`.
- [ ] Note the cluster endpoint — this becomes the host in your `DATABASE_URL`

## 3. Amazon ElastiCache (Redis)

- [ ] Create an ElastiCache Redis cluster (single-node `cache.t3.micro` is sufficient for demo)
- [ ] Enable **in-transit encryption** (TLS) — use `rediss://` scheme in the URL
- [ ] Set an AUTH token if encryption is enabled
- [ ] Place in the same VPC as your backend, security group allowing port `6379` from backend only
- [ ] Note the endpoint — this becomes your `REDIS_URL`:
  ```
  REDIS_URL=rediss://:<auth-token>@<endpoint>:6379/0
  ```
- [ ] **Alternative (simpler for MVP):** Skip ElastiCache, run Redis on the EC2 instance via Docker alongside the app (matches the docker-compose setup). Use `redis://localhost:6379/0`.

## 4. Amazon S3 Buckets

- [ ] Create bucket: `axiom-source-documents` (raw PDFs, lecture audio, video)
- [ ] Create bucket: `axiom-transcriptions` (Transcribe output)
- [ ] Create bucket: `axiom-audio` (Polly-generated MP3s)
- [ ] Block all public access on all three buckets (use presigned URLs only)
- [ ] Add a CORS policy on `axiom-source-documents` allowing `PUT` from your Amplify domain
- [ ] Consider adding S3 lifecycle rules to expire old audio/transcription files after 90 days

## 5. Amazon Bedrock

- [ ] In the Bedrock console, navigate to **Model access** → request access to:
  - `anthropic.claude-sonnet-4-6` (chat, grading, activity generation, audio scripts)
  - `amazon.titan-embed-text-v2:0` (1024-dim embeddings for RAG)
- [ ] Wait for access to be approved (usually instant, can take a few minutes)
- [ ] Verify with the AWS CLI: `aws bedrock list-foundation-models --region us-east-1`

## 6. Amazon EC2 (Backend)

- [ ] Launch an instance: **t3.medium** (2 vCPU, 4 GB RAM — enough for FastAPI + Celery worker)
- [ ] AMI: **Amazon Linux 2023** or **Ubuntu 22.04**
- [ ] **Attach the IAM instance role** created in step 1 (preferred over static keys)
- [ ] Security group inbound rules:
  - `443` (HTTPS) from `0.0.0.0/0`
  - `80` (HTTP, for Certbot challenge) from `0.0.0.0/0`
  - `8000` (FastAPI API) from `0.0.0.0/0`
  - `22` (SSH) from your IP only
- [ ] Allocate and associate an **Elastic IP**
- [ ] SSH in and install: `docker`, `docker-compose`, `certbot`
- [ ] Set up the sslip.io domain: `<your-elastic-ip>.sslip.io`
- [ ] Run Certbot: `sudo certbot certonly --standalone -d <elastic-ip>.sslip.io`
- [ ] **Automatic Bootstrap via CloudFormation:** When deploying via `cloudformation.yaml`, EC2 automatically clones the repository from `GitRepositoryURL`, generates `/backend/.env`, and executes `/home/ec2-user/app/backend/scripts/deploy_ec2.sh` to build and start the Docker containers.
- [ ] **Manual SSH Deployment / Update Script:** To pull latest updates or re-deploy manually:
  ```bash
  cd /home/ec2-user/app/backend
  chmod +x scripts/deploy_ec2.sh
  ./scripts/deploy_ec2.sh
  ```
- [ ] Create `/backend/.env` from `.env.example` with **production values** (if deploying manually without CloudFormation):
  ```env
  # ── Database ──────────────────────────────────────────────────
  DATABASE_URL=postgresql+asyncpg://<user>:<pass>@<aurora-endpoint>:5432/axiom
  SYNC_DATABASE_URL=postgresql+psycopg2://<user>:<pass>@<aurora-endpoint>:5432/axiom
  DATABASE_SSL=true

  # ── Redis ─────────────────────────────────────────────────────
  REDIS_URL=rediss://:<auth-token>@<redis-endpoint>:6379/0

  # ── AWS (leave blank if using IAM role — boto3 auto-discovers) ─
  AWS_DEFAULT_REGION=us-east-1
  AWS_ACCESS_KEY_ID=
  AWS_SECRET_ACCESS_KEY=

  # ── JWT (REQUIRED — generate with: python -c "import secrets; print(secrets.token_urlsafe(64))") ─
  JWT_SECRET_KEY=<your-random-64-char-string>

  # ── App / Security ───────────────────────────────────────────
  ENVIRONMENT=production
  LOG_LEVEL=info
  CORS_ORIGINS=https://main.d123.amplifyapp.com
  UPLOAD_MAX_BYTES=52428800

  # ── Demo auth (DISABLE in production) ─────────────────────────
  ENABLE_DEMO_AUTH=false
  RUN_SEED_ON_STARTUP=false

  # ── S3 Buckets ───────────────────────────────────────────────
  S3_BUCKET_NAME=axiom-source-documents
  TRANSCRIBE_OUTPUT_BUCKET=axiom-transcriptions
  TEXTRACT_OUTPUT_BUCKET=axiom-textract-results
  POLLY_OUTPUT_BUCKET=axiom-audio
  POLLY_VOICE_ID=Matthew
  POLLY_ENGINE=neural
  ```
- [ ] **First deploy only:** Run seed to populate demo data:
  ```bash
  RUN_SEED_ON_STARTUP=true python -m scripts.seed
  ```
  Then set `RUN_SEED_ON_STARTUP=false` in `.env` so it doesn't re-run on restarts.
- [ ] Run `docker compose up -d` (starts API + Celery worker + Redis)
- [ ] Verify health: `curl https://<elastic-ip>.sslip.io/health` should return `{"status": "healthy"}`
- [ ] Verify Swagger: `curl https://<elastic-ip>.sslip.io/docs`

### Production deployment notes

- The app **refuses to start** if `ENVIRONMENT=production` and `JWT_SECRET_KEY` is still the default placeholder. This is intentional — you must set a real secret.
- With `ENABLE_DEMO_AUTH=false`, the `X-Demo-User` header is rejected. All users must authenticate via JWT (`/api/auth/register` and `/api/auth/login`).
- Rate limiting is active: `/api/auth/login` = 10/min, `/api/auth/register` = 5/min, chat messages = 20/min, search = 30/min, all other endpoints = 200/min per IP.
- File uploads are capped at `UPLOAD_MAX_BYTES` (default 50 MB).
- CORS is restricted to the origins in `CORS_ORIGINS` — make sure your Amplify domain is listed.

## 7. AWS Amplify (Frontend)

- [ ] Push the repo to a GitHub repository (if not already)
- [ ] In the Amplify console → **Host web app** → connect your GitHub repo
- [ ] Set the app root to `frontend/`
- [ ] Set build settings (Amplify auto-detects Next.js, but confirm):
  ```yaml
  version: 1
  frontend:
    phases:
      preBuild:
        commands:
          - npm ci
      build:
        commands:
          - npm run build
    artifacts:
      baseDirectory: out
      files:
        - '**/*'
    cache:
      paths:
        - node_modules/**/*
  ```
- [ ] Add environment variable: `NEXT_PUBLIC_API_URL=https://<elastic-ip>.sslip.io`
- [ ] **Do NOT set** `NEXT_PUBLIC_DEFAULT_USER` in production (it's only for local dev)
- [ ] Trigger a deploy — Amplify gives you a URL like `https://main.d123.amplifyapp.com`
- [ ] **Update** the backend `CORS_ORIGINS` to include this Amplify URL, then restart the backend

### Frontend notes

- All API calls go through `frontend/src/lib/api.ts` using the `NEXT_PUBLIC_API_URL` env var. No other files reference the backend URL.
- The `next.config.js` has a rewrite rule pointing to `localhost:8000` — this is dead code in production (all fetches use the full absolute URL from the env var) but can be removed to avoid confusion.
- The frontend has hardcoded demo data as fallbacks in every component. When the backend is reachable, live data replaces it. When unreachable, demo data shows silently — there are no error toasts. This is by design for the hackathon demo, but should be replaced with proper error states for production.
- `ActivityFeed.tsx` lines 674 and 689 hardcode `"usr_student_demo"` for activity evaluation API calls — this needs to be fixed to pass the actual logged-in user ID before real multi-user use.

## 8. Amazon Transcribe (Speech-to-Text)

- [ ] No pre-provisioning needed — it's API-driven
- [ ] Verify IAM role has `transcribe:StartTranscriptionJob`, `transcribe:GetTranscriptionJob` permissions
- [ ] Test: upload an audio file to S3 → start a transcription job → confirm output lands in `axiom-transcriptions`
- [ ] **Known limitation:** Language is hardcoded to `en-US` in `backend/app/services/transcribe.py`. Non-English content will not transcribe correctly.

## 9. Amazon Polly (Text-to-Speech)

- [ ] No pre-provisioning needed — API-driven
- [ ] Verify IAM role has `polly:SynthesizeSpeech`, `polly:StartSpeechSynthesisTask`, `polly:GetSpeechSynthesisTask` permissions
- [ ] Verify IAM role has `s3:PutObject` on the `axiom-audio` bucket (Polly writes long-form audio directly to S3)
- [ ] Test: call the `/api/audio/synthesize` endpoint → confirm MP3 is created in S3

## 10. End-to-End Smoke Test

- [ ] Open the Amplify URL in a browser
- [ ] **Register** a new student account via `/signup` — confirm JWT auth works (not demo headers)
- [ ] **Register** a new teacher account
- [ ] **As student:** verify activity feed loads, chat responds (Bedrock), wiki pages display, node map renders
- [ ] **As student:** generate a quiz → submit answers → confirm grading works
- [ ] **As student:** generate an audio overview → confirm Polly audio plays
- [ ] **As teacher:** verify dashboard loads, wiki CRUD works (create/edit/delete pages + claims)
- [ ] **As teacher:** create a classroom → get the join code → join as student → verify enrollment
- [ ] Upload a source document (PDF or markdown) → confirm ingestion pipeline runs (claims appear after processing)
- [ ] Send a chat message → confirm it hits the Bedrock API and returns a contextual response
- [ ] Use the chat to create activities ("make flashcards for Row Reduction") → confirm tool-use works
- [ ] Check `/health` endpoint → all three checks (api, database, redis) should show "ok"

## 11. Known Issues to Address Post-Hackathon

These are documented from the codebase audit but are acceptable for a hackathon demo:

- **Missing workspace authorization (IDOR):** Most routes (topics, claims, DAG, audio, glossary) don't verify the user owns the workspace. Any authenticated user can access any workspace's data. (Search endpoint now requires and enforces `workspace_id`.)
- **No Polly retry logic:** Unlike Bedrock calls, Polly has no retry on throttling errors.
- **boto3 client proliferation in `ingestion.py`:** Creates new clients per function call instead of reusing singletons. Wasteful under load.
- **Thread-unsafe singletons:** All boto3 singleton patterns use `global` + `if None` without locking.
- **Long-form Polly synthesis is fire-and-forget:** No polling for completion — presigned URL may 404 if audio isn't ready yet.
- **Quiz grading is client-only for non-short-answer:** The frontend grades T/F, MC, and fill-blank locally. Only short_answer calls the backend LLM grader.
- **Frontend `callEvaluate` hardcodes `"usr_student_demo"`:** Activity grading is attributed to the wrong user.
- **Unused component files:** `src/components/activities/` contains 6 standalone activity components that are dead code (ActivityFeed has its own inline renderers).

## Cost Estimate (MVP / Demo)

| Service | Expected Monthly |
|---|---|
| EC2 t3.medium | ~$30 |
| Aurora Serverless v2 (0.5 ACU min) | ~$44 |
| ElastiCache t3.micro (if used) | ~$12 |
| S3 (< 1 GB) | < $1 |
| Amplify (build + hosting) | Free tier likely covers it |
| Bedrock (low volume) | Pay-per-token, ~$5–15 for demo use |
| Transcribe / Polly | Pay-per-use, < $5 for demo |
| **Total** | **~$90–110/month** |

> **Tip:** To minimize costs during the hackathon, stop the EC2 instance and pause Aurora when not demoing. Aurora Serverless v2 scales to 0 ACU when idle if configured, but you still pay for storage (~$0.10/GB/month).

## Quick Reference: Environment Variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | Yes | localhost dev URL | Aurora asyncpg connection string |
| `SYNC_DATABASE_URL` | Yes | localhost dev URL | Aurora psycopg2 connection string (Celery/Alembic) |
| `DATABASE_SSL` | No | `false` | Set `true` for Aurora |
| `REDIS_URL` | Yes | `redis://localhost:6379/0` | Use `rediss://` for ElastiCache TLS |
| `AWS_DEFAULT_REGION` | No | `us-east-1` | Must match Bedrock model region |
| `AWS_ACCESS_KEY_ID` | No | None | Leave blank when using IAM roles |
| `AWS_SECRET_ACCESS_KEY` | No | None | Leave blank when using IAM roles |
| `JWT_SECRET_KEY` | **Yes** | Placeholder (fails in prod) | Generate: `python -c "import secrets; print(secrets.token_urlsafe(64))"` |
| `ENVIRONMENT` | No | `development` | Set `production` on AWS — enforces JWT secret |
| `CORS_ORIGINS` | Yes | localhost | Comma-separated list of allowed frontend origins |
| `ENABLE_DEMO_AUTH` | No | `true` | Set `false` in production |
| `RUN_SEED_ON_STARTUP` | No | `true` | Set `false` after initial seed |
| `UPLOAD_MAX_BYTES` | No | 52428800 (50 MB) | Max file upload size |
| `S3_BUCKET_NAME` | No | `axiom-source-documents` | Source document bucket |
| `POLLY_OUTPUT_BUCKET` | No | `axiom-audio` | Polly audio output bucket |
| `TRANSCRIBE_OUTPUT_BUCKET` | No | `axiom-transcriptions` | Transcribe output bucket |
| `BEDROCK_MODEL_ID` | No | `anthropic.claude-sonnet-4-6` | LLM for chat/grading/generation |
| `BEDROCK_EMBED_MODEL_ID` | No | `amazon.titan-embed-text-v2:0` | Embedding model (1024-dim) |
| `LOG_LEVEL` | No | `info` | `debug` / `info` / `warning` |
