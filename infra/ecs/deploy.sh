#!/usr/bin/env bash
#
# Deploy Axiom backend to ECS Fargate.
#
# Usage:
#   ./infra/ecs/deploy.sh                    # build + push + update services
#   ./infra/ecs/deploy.sh --stack-only       # deploy CloudFormation stack only
#   ./infra/ecs/deploy.sh --build-only       # build + push image only
#
# Prerequisites:
#   - AWS CLI configured with correct profile/region
#   - Docker running
#   - ECR repository created (aws ecr create-repository --repository-name axiom)
#
set -euo pipefail

REGION="${AWS_DEFAULT_REGION:-us-east-1}"
STACK_NAME="${STACK_NAME:-axiom}"
ECR_REPO="${ECR_REPO:-axiom}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD)}"

echo "=== Axiom ECS Deploy ==="
echo "Region:    ${REGION}"
echo "Stack:     ${STACK_NAME}"
echo "ECR:       ${ECR_URI}"
echo "Tag:       ${IMAGE_TAG}"
echo ""

build_and_push() {
    echo "── Logging into ECR..."
    aws ecr get-login-password --region "${REGION}" | \
        docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

    echo "── Building Docker image..."
    docker build -t "${ECR_REPO}:${IMAGE_TAG}" -t "${ECR_REPO}:latest" ./backend

    echo "── Tagging for ECR..."
    docker tag "${ECR_REPO}:${IMAGE_TAG}" "${ECR_URI}:${IMAGE_TAG}"
    docker tag "${ECR_REPO}:latest" "${ECR_URI}:latest"

    echo "── Pushing to ECR..."
    docker push "${ECR_URI}:${IMAGE_TAG}"
    docker push "${ECR_URI}:latest"

    echo "── Image pushed: ${ECR_URI}:${IMAGE_TAG}"
}

deploy_stack() {
    echo "── Deploying CloudFormation stack..."
    aws cloudformation deploy \
        --template-file infra/ecs/cloudformation.yml \
        --stack-name "${STACK_NAME}" \
        --capabilities CAPABILITY_NAMED_IAM \
        --parameter-overrides \
            EnvironmentName="${STACK_NAME}" \
            ImageUri="${ECR_URI}:${IMAGE_TAG}" \
        --no-fail-on-empty-changeset

    echo "── Stack outputs:"
    aws cloudformation describe-stacks \
        --stack-name "${STACK_NAME}" \
        --query "Stacks[0].Outputs" \
        --output table
}

update_services() {
    CLUSTER="${STACK_NAME}-cluster"

    echo "── Forcing new deployment for API service..."
    aws ecs update-service \
        --cluster "${CLUSTER}" \
        --service "${STACK_NAME}-api" \
        --force-new-deployment \
        --query "service.deployments[0].status" \
        --output text

    echo "── Forcing new deployment for Worker service..."
    aws ecs update-service \
        --cluster "${CLUSTER}" \
        --service "${STACK_NAME}-worker" \
        --force-new-deployment \
        --query "service.deployments[0].status" \
        --output text

    echo ""
    echo "=== Deploy complete ==="
    ALB_DNS=$(aws cloudformation describe-stacks \
        --stack-name "${STACK_NAME}" \
        --query "Stacks[0].Outputs[?OutputKey=='AlbDnsName'].OutputValue" \
        --output text)
    echo "API endpoint: http://${ALB_DNS}"
    echo "Health check: http://${ALB_DNS}/health"
}

case "${1:-all}" in
    --stack-only)
        deploy_stack
        ;;
    --build-only)
        build_and_push
        ;;
    all|"")
        build_and_push
        deploy_stack
        update_services
        ;;
    *)
        echo "Usage: $0 [--stack-only | --build-only]"
        exit 1
        ;;
esac
