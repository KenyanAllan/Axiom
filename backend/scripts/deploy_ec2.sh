#!/bin/bash
set -e

# Axiom EC2 Backend Build & Deploy Script
# This script pulls the latest code from GitHub and builds/restarts the backend stack.

REPO_DIR="/home/ec2-user/app"
BACKEND_DIR="${REPO_DIR}/backend"
REPO_URL="${1:-https://github.com/KenyanAllan/Axiom.git}"
BRANCH="${2:-main}"

echo "=== Axiom EC2 Deployment Starting ==="
echo "Timestamp: $(date -u)"

# Always step out of REPO_DIR so we never delete the script's current working directory
cd /home/ec2-user

# Backup .env in memory if it already exists
ENV_BACKUP=""
if [ -f "${BACKEND_DIR}/.env" ]; then
    ENV_BACKUP=$(cat "${BACKEND_DIR}/.env")
fi

if [ -d "${REPO_DIR}/.git" ]; then
    echo "Updating existing repository in ${REPO_DIR}..."
    cd "${REPO_DIR}"
    git fetch origin
    git checkout "${BRANCH}"
    git pull origin "${BRANCH}"
else
    echo "Cloning repository from ${REPO_URL} (branch: ${BRANCH})..."
    rm -rf "${REPO_DIR}"
    git clone -b "${BRANCH}" "${REPO_URL}" "${REPO_DIR}"
fi

cd "${BACKEND_DIR}"

# Restore or create .env file
if [ ! -f .env ] && [ -n "${ENV_BACKUP}" ]; then
    echo "Restoring existing .env configuration..."
    echo "${ENV_BACKUP}" > .env
elif [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo "Copying .env.example to .env..."
        cp .env.example .env
        echo "NOTE: Update ${BACKEND_DIR}/.env with production credentials."
    else
        echo "ERROR: .env.example missing in ${BACKEND_DIR}."
        exit 1
    fi
fi

# Build and launch Docker Compose stack
echo "Building and starting backend containers..."
export DOCKER_BUILDKIT=0
docker compose down || true
docker compose build
docker compose up -d

# Wait for services and perform health check
echo "Waiting 10s for backend services to initialize..."
sleep 10

if curl -sf http://localhost:8000/health | grep -q "healthy"; then
    echo "SUCCESS: Backend deployment verified healthy!"
else
    echo "WARNING: Health check did not report 'healthy'. Container logs:"
    docker compose logs --tail=30 api
fi

echo "=== Axiom EC2 Deployment Complete ==="
