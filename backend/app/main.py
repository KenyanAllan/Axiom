"""FastAPI entry point for the APKGS backend."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.activities import router as activities_router
from app.api.routes.classrooms import router as classrooms_router
from app.api.routes.topics import router as topics_router
from app.api.routes.workspaces import router as workspaces_router
from app.core.config import get_settings

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)

app = FastAPI(
    title="APKGS API",
    description="Autonomous Pedagogical Knowledge Graph System — backend API",
    version="0.1.0",
)

# ── CORS (allow the Next.js frontend in dev) ─────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ──────────────────────────────────────────────────────────────────

app.include_router(activities_router)
app.include_router(classrooms_router)
app.include_router(topics_router)
app.include_router(workspaces_router)


# ── Health check ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "apkgs-api"}
