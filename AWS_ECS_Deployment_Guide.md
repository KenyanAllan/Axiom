# Axiom — AWS ECS Fargate Deployment Guide

This guide walks you through deploying the Axiom backend API on **AWS ECS (Elastic Container Service) with Fargate (Serverless Containers)** on the `ecs-deployment` branch.

---

## 1. Single-Line CloudFormation Stack Deployment

The template [`ecs-cloudformation.yaml`](file:///c:/Users/kenya/Documents/Hackathon/Axiom/ecs-cloudformation.yaml) is self-contained and creates its own VPC, Subnets, ALB, ECR Repository, ECS Cluster, and Fargate Service.

Run this **single 1-line command** in PowerShell or Terminal:

```powershell
aws cloudformation deploy --template-file ecs-cloudformation.yaml --stack-name axiom-ecs-stack --capabilities CAPABILITY_IAM
```

*(No backslashes or line breaks needed!)*

---

## 2. Build, Push to ECR, and Deploy Containers

Once the CloudFormation stack creation completes, run the automated ECR push & deployment script:

### On Git Bash / WSL / EC2 Terminal:
```bash
cd backend
chmod +x scripts/deploy_ecs.sh
./scripts/deploy_ecs.sh us-east-1
```

### Or Manually via AWS CLI & Docker:
```powershell
# 1. Login to Amazon ECR (replace <ACCOUNT_ID> with your AWS Account ID)
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# 2. Build and Tag Docker Image
cd backend
$env:DOCKER_BUILDKIT=0
docker build -t axiom-backend .
docker tag axiom-backend:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/axiom-backend:latest

# 3. Push Image to ECR
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/axiom-backend:latest

# 4. Trigger ECS Rolling Deployment
aws ecs update-service --cluster axiom-cluster --service axiom-backend-service --force-new-deployment --region us-east-1
```

---

## 3. Get your Load Balancer URL & Test Health

Retrieve your Application Load Balancer URL:

```powershell
aws cloudformation describe-stacks --stack-name axiom-ecs-stack --query "Stacks[0].Outputs[?OutputKey=='ALBURL'].OutputValue" --output text
```

Test health endpoint in your browser or curl:
```text
http://<ALB_DNS_NAME>/health
```
