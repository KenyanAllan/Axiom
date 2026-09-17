#!/bin/bash
set -e

# Axiom AWS ECS Fargate Build & Deployment Script
# Build Docker image, push to ECR, and force a new ECS Fargate deployment

AWS_REGION="${1:-us-east-1}"
PROJECT_NAME="axiom"
CLUSTER_NAME="${PROJECT_NAME}-cluster"
SERVICE_NAME="${PROJECT_NAME}-backend-service"
ECR_REPO_NAME="${PROJECT_NAME}-backend"

echo "=== Axiom AWS ECS Deployment Starting ==="
echo "Timestamp: $(date -u)"

# 1. Get AWS Account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO_NAME}"

echo "AWS Account ID: ${AWS_ACCOUNT_ID}"
echo "ECR Repository URI: ${ECR_URI}"

# 2. Login to Amazon ECR
echo "Authenticating Docker with Amazon ECR..."
aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${ECR_URI}"

# 3. Ensure ECR repository exists
aws ecr describe-repositories --repository-names "${ECR_REPO_NAME}" --region "${AWS_REGION}" &>/dev/null || \
aws ecr create-repository --repository-name "${ECR_REPO_NAME}" --region "${AWS_REGION}"

# 4. Build and tag Docker image
echo "Building backend Docker image..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${BACKEND_DIR}"

export DOCKER_BUILDKIT=0
docker build -t "${ECR_REPO_NAME}:latest" .
docker tag "${ECR_REPO_NAME}:latest" "${ECR_URI}:latest"

# 5. Push Docker image to Amazon ECR
echo "Pushing image to Amazon ECR..."
docker push "${ECR_URI}:latest"

# 6. Trigger ECS Rolling Deployment
echo "Triggering new ECS Fargate deployment..."
aws ecs update-service \
    --cluster "${CLUSTER_NAME}" \
    --service "${SERVICE_NAME}" \
    --force-new-deployment \
    --region "${AWS_REGION}"

echo "=== Axiom AWS ECS Deployment Triggered Successfully ==="
echo "Monitor service status with: aws ecs describe-services --cluster ${CLUSTER_NAME} --services ${SERVICE_NAME} --region ${AWS_REGION}"
