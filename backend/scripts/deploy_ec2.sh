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

# 1. Ensure directory exists and clone/pull latest code
if [ ! -d "${REPO_DIR}/.git" ]; then
    echo "Cloning repository from ${REPO_URL} (branch: ${BRANCH})..."
    mkdir -p "${REPO_DIR}"
    git clone -b "${BRANCH}" "${REPO_URL}" "${REPO_DIR}"
else
    echo "Updating existing repository in ${REPO_DIR}..."
    cd "${REPO_DIR}"
    git fetch origin
    git checkout "${BRANCH}"
    git pull origin "${BRANCH}"
fi

cd "${BACKEND_DIR}"

# 2. Check for .env file
if [ ! -f .env ]; then
    echo "WARNING: .env file not found in ${BACKEND_DIR}!"
    if [ -f .env.example ]; then
        echo "Copying .env.example to .env..."
        cp .env.example .env
        echo "NOTE: Update ${BACKEND_DIR}/.env with production credentials."
    else
        echo "ERROR: .env.example missing in ${BACKEND_DIR}."
        exit 1
    fi
fi

# 3. Build and launch Docker Compose stack
echo "Building and starting backend containers..."
docker compose down || true
docker compose build
docker compose up -d

# 4. Wait for services and perform health check
echo "Waiting 10s for backend services to initialize..."
sleep 10

if curl -sf http://localhost:8000/health | grep -q "healthy"; then
    echo "SUCCESS: Backend deployment verified healthy!"
else
    echo "WARNING: Health check did not report 'healthy'. Container logs:"
    docker compose logs --tail=30 api
fi

echo "=== Axiom EC2 Deployment Complete ==="
