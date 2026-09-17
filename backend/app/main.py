"""FastAPI entry point for the Axiom backend."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core.config import get_settings
from app.core.rate_limit import limiter

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Axiom API",
    description="Axiom — technical learning workspace backend API",
    version="0.1.0",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS ─────────────────────────────────────────────────────────────────────

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Demo-User", "Accept"],
)

# ── Global exception handler ─────────────────────────────────────────────────


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception on %s %s: %s", request.method, request.url, exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


# ── Routers ──────────────────────────────────────────────────────────────────

from app.api.routes.activities import router as activities_router
from app.api.routes.classrooms import router as classrooms_router
from app.api.routes.topics import router as topics_router
from app.api.routes.workspaces import router as workspaces_router
from app.api.routes.users import router as users_router
from app.api.routes.auth import router as auth_router
from app.api.routes.sources import router as sources_router
from app.api.routes.search import router as search_router
from app.api.routes.chat import router as chat_router
from app.api.routes.dag import router as dag_router
from app.api.routes.claims import router as claims_router
from app.api.routes.audio import router as audio_router
from app.api.routes.glossary import router as glossary_router

app.include_router(auth_router)
app.include_router(activities_router)
app.include_router(classrooms_router)
app.include_router(topics_router)
app.include_router(workspaces_router)
app.include_router(users_router)
app.include_router(sources_router)
app.include_router(search_router)
app.include_router(chat_router)
app.include_router(dag_router)
app.include_router(claims_router)
app.include_router(audio_router)
app.include_router(glossary_router)


# ── Health check ─────────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    from sqlalchemy import text
    from app.core.database import async_session_factory

    checks = {"api": "ok"}
    try:
        async with async_session_factory() as session:
            await session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception:
        checks["database"] = "unavailable"

    try:
        import redis as redis_lib
        r = redis_lib.from_url(settings.redis_url, socket_connect_timeout=2)
        r.ping()
        checks["redis"] = "ok"
    except Exception:
        checks["redis"] = "unavailable"

    all_ok = all(v == "ok" for v in checks.values())
    return JSONResponse(
        status_code=200 if all_ok else 503,
        content={"status": "healthy" if all_ok else "degraded", "checks": checks},
    )
