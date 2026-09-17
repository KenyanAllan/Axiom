# Axiom — AWS ECS Fargate Deployment Guide

This guide walks you through deploying the Axiom backend API on **AWS ECS (Elastic Container Service) with Fargate (Serverless Containers)** on the `ecs-deployment` branch.

---

## Architecture Overview

```
[ User Browser / Amplify Frontend ]
           │
           │ HTTPS / HTTP (Port 80)
           ▼
[ Application Load Balancer (ALB) ]
           │
           │ Target Group (Health check: GET /health on Port 8000)
           ▼
   [ AWS ECS Cluster ] (Fargate Serverless Tasks)
     ├── Container: `api` (FastAPI / Uvicorn on Port 8000)
     └── Container: `worker` (Celery background worker)
           │
           ├── IAM Task Role (`ECSTaskRole`)
           │   ├── Amazon Bedrock (Claude Sonnet & Titan Embeddings)
           │   ├── Amazon S3 (Existing buckets: `axiom-source-documents`, etc.)
           │   └── Amazon Transcribe / Polly / Textract / Translate / Comprehend
           │
           └── Database & Cache Connections
               ├── Aurora / RDS PostgreSQL 16
               └── Redis Cache
```

---

## What's Included on the `ecs-deployment` Branch

| File | Purpose |
|---|---|
| [`ecs-cloudformation.yaml`](file:///c:/Users/kenya/Documents/Hackathon/Axiom/ecs-cloudformation.yaml) | CloudFormation template that provisions ECS Cluster, Fargate Task Definition, ALB, Target Group, ECR Repository, IAM Roles, and CloudWatch Log Group. |
| [`ecs-task-definition.json`](file:///c:/Users/kenya/Documents/Hackathon/Axiom/ecs-task-definition.json) | Standalone JSON specification for AWS ECS Task Definitions. |
| [`backend/scripts/deploy_ecs.sh`](file:///c:/Users/kenya/Documents/Hackathon/Axiom/backend/scripts/deploy_ecs.sh) | Automated bash script to build Docker images, push to ECR, and trigger rolling ECS Fargate deployments. |

---

## Step-by-Step Deployment Instructions

### Step 1: Deploy the ECS Infrastructure Stack

Use AWS CLI or the CloudFormation Console to deploy `ecs-cloudformation.yaml`:

```bash
aws cloudformation deploy \
  --template-file ecs-cloudformation.yaml \
  --stack-name axiom-ecs-stack \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
      VPCId=vpc-xxxxxxxx \
      SubnetIds=subnet-11111111,subnet-22222222 \
      DatabaseURL="postgresql+asyncpg://axiom_admin:YourPass@your-rds-endpoint:5432/axiom" \
      SyncDatabaseURL="postgresql+psycopg2://axiom_admin:YourPass@your-rds-endpoint:5432/axiom" \
      JWTSecretKey="your-random-64-character-jwt-secret-key" \
      CORSOrigins="*"
```

---

### Step 2: Build, Push to ECR, and Deploy to ECS Fargate

Run the automated build & deployment script:

```bash
cd backend
chmod +x scripts/deploy_ecs.sh
./scripts/deploy_ecs.sh us-east-1
```

This script automatically:
1. Authenticates your Docker CLI with Amazon ECR (`aws ecr get-login-password`).
2. Builds the backend container image (`docker build`).
3. Tags and pushes the image to ECR (`<account-id>.dkr.ecr.us-east-1.amazonaws.com/axiom-backend:latest`).
4. Triggers an instant rolling update on AWS ECS (`aws ecs update-service --force-new-deployment`).

---

### Step 3: Get your Load Balancer URL & Verify Health

Retrieve your Application Load Balancer DNS Name:

```bash
aws cloudformation describe-stacks \
  --stack-name axiom-ecs-stack \
  --query "Stacks[0].Outputs[?OutputKey=='ALBURL'].OutputValue" \
  --output text
```

Verify backend health:

```bash
curl http://<ALB-DNS-NAME>/health
```

*Expected Response:*
```json
{"status":"healthy","checks":{"api":"ok","database":"ok","redis":"ok"}}
```

---

### Step 4: Connect AWS Amplify Frontend

In your **AWS Amplify Console** → **Environment Variables**, update `NEXT_PUBLIC_API_URL`:

```env
NEXT_PUBLIC_API_URL=http://<ALB-DNS-NAME>
```

Trigger a frontend rebuild on Amplify, and your full stack is live on AWS ECS Fargate!
