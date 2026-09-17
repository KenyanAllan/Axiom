# Axiom — AWS Deployment Checklist

## 1. AWS Account & IAM

- [ ] Create (or confirm) an AWS account with billing enabled
- [ ] Create an IAM user/role with programmatic access for deployment
- [ ] Attach policies: `AmazonEC2FullAccess`, `AmazonS3FullAccess`, `AmazonBedrockFullAccess`, `AmazonSQSFullAccess`, `AmazonTranscribeFullAccess`, `AmazonPollyFullAccess`, `AmazonRDSFullAccess`, `AmplifyFullAccess`
- [ ] Generate `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` — store securely, never commit
- [ ] Set default region: `us-east-1` (must match Bedrock model availability)

## 2. Amazon Aurora Serverless v2 (PostgreSQL + pgvector)

- [ ] Create an Aurora Serverless v2 cluster — engine **PostgreSQL 16**
- [ ] Set master username/password (replace `axiom` / `axiom_dev_secret`)
- [ ] Set min capacity to **0.5 ACU**, max to **2 ACU** (keeps costs low for demo)
- [ ] Place in a VPC + security group that allows inbound on port `5432` from your EC2
- [ ] Connect and enable the extension: `CREATE EXTENSION IF NOT EXISTS vector;`
- [ ] Note the cluster endpoint — this becomes your `DATABASE_URL` host

## 3. Amazon S3 Buckets

- [ ] Create bucket: `axiom-source-documents` (raw PDFs, lecture audio, video)
- [ ] Create bucket: `axiom-transcriptions` (Transcribe output)
- [ ] Create bucket: `axiom-audio` (Polly-generated MP3s)
- [ ] Block all public access on all three buckets (use presigned URLs only)
- [ ] Add a CORS policy on `axiom-source-documents` allowing `PUT` from your Amplify domain

## 4. Amazon Bedrock

- [ ] In the Bedrock console, navigate to **Model access** → request access to:
  - `anthropic.claude-3-5-sonnet-20241022-v2:0`
  - `amazon.titan-embed-text-v2:0`
- [ ] Wait for access to be approved (usually instant, can take a few minutes)
- [ ] Verify with the AWS CLI: `aws bedrock list-foundation-models --region us-east-1`

## 5. Amazon SQS

- [ ] Create a standard queue: `axiom-ingestion` (replaces the local Redis/Celery broker)
- [ ] Note the queue URL — you'll configure the Celery backend to use SQS or keep Redis on EC2
- [ ] **Alternative (simpler for MVP):** Skip SQS, run Redis on the EC2 instance alongside the app (matches your current docker-compose setup)

## 6. Amazon EC2 (Backend)

- [ ] Launch an instance: **t3.medium** (2 vCPU, 4 GB RAM — enough for FastAPI + Celery worker)
- [ ] AMI: **Amazon Linux 2023** or **Ubuntu 22.04**
- [ ] Security group inbound rules:
  - `443` (HTTPS) from `0.0.0.0/0`
  - `80` (HTTP, for Certbot challenge) from `0.0.0.0/0`
  - `22` (SSH) from your IP only
- [ ] Allocate and associate an **Elastic IP**
- [ ] SSH in and install: `docker`, `docker-compose`, `certbot`
- [ ] Set up the sslip.io domain: `<your-elastic-ip>.sslip.io`
- [ ] Run Certbot: `sudo certbot certonly --standalone -d <elastic-ip>.sslip.io`
- [ ] Clone the repo onto the instance
- [ ] Create `/backend/.env` from `.env.example` with production values:
  ```
  DATABASE_URL=postgresql+asyncpg://<user>:<pass>@<aurora-endpoint>:5432/axiom
  SYNC_DATABASE_URL=postgresql+psycopg2://<user>:<pass>@<aurora-endpoint>:5432/axiom
  AWS_ACCESS_KEY_ID=<key>
  AWS_SECRET_ACCESS_KEY=<secret>
  JWT_SECRET_KEY=<random-64-char-string>
  CORS_ORIGINS=https://main.d123.amplifyapp.com
  S3_BUCKET_NAME=axiom-source-documents
  TRANSCRIBE_OUTPUT_BUCKET=axiom-transcriptions
  POLLY_OUTPUT_BUCKET=axiom-audio
  POLLY_VOICE_ID=Matthew
  POLLY_ENGINE=neural
  LOG_LEVEL=info
  ```
- [ ] Run `docker compose up -d` (this runs migrations via `start.sh`, seeds data, starts API + worker)
- [ ] Verify health: `curl https://<elastic-ip>.sslip.io/docs` should show FastAPI Swagger

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
      baseDirectory: .next
      files:
        - '**/*'
    cache:
      paths:
        - node_modules/**/*
  ```
- [ ] Add environment variable: `NEXT_PUBLIC_API_URL=https://<elastic-ip>.sslip.io`
- [ ] Trigger a deploy — Amplify gives you a URL like `https://main.d123.amplifyapp.com`
- [ ] Test login with `usr_student_demo` and `usr_teacher_demo`

## 8. Amazon Transcribe (Speech-to-Text)

- [ ] No pre-provisioning needed — it's API-driven
- [ ] Verify IAM role has `transcribe:StartTranscriptionJob` permission
- [ ] Test: upload an audio file to S3 → start a transcription job → confirm output lands in `axiom-transcriptions`

## 9. Amazon Polly (Text-to-Speech)

- [ ] No pre-provisioning needed — API-driven
- [ ] Verify IAM role has `polly:SynthesizeSpeech` and `polly:GetSpeechSynthesisTask`
- [ ] Test: call `synthesize_speech` with `VoiceId=Matthew`, `Engine=neural` → confirm MP3 output

## 10. End-to-End Smoke Test

- [ ] Open the Amplify URL in a browser
- [ ] Log in as student → verify: activity feed, chat, wiki (read-only), node map
- [ ] Log in as teacher → verify: dashboard, wiki CRUD (create/edit/delete pages + claims)
- [ ] Send a chat message → confirm it hits the API and returns a response
- [ ] Click a node on the map → confirm it navigates to the correct wiki page
- [ ] Click a claim → confirm it appears as a context chip in chat

## Cost Estimate (MVP / Demo)

| Service | Expected Monthly |
|---|---|
| EC2 t3.medium | ~$30 |
| Aurora Serverless v2 (0.5 ACU min) | ~$44 |
| S3 (< 1 GB) | < $1 |
| Amplify (build + hosting) | Free tier likely covers it |
| Bedrock (low volume) | Pay-per-token, ~$5–15 for demo use |
| SQS / Transcribe / Polly | Pay-per-use, < $5 for demo |
| **Total** | **~$80–95/month** |

> **Tip:** To minimize costs during the hackathon, stop the EC2 instance and pause Aurora when not demoing. Aurora Serverless v2 scales to 0 ACU when idle if configured, but you still pay for storage.
