import logging
import os
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from app.api.health import router as health_router
from app.api.v1.accounts import router as accounts_router
from app.config import get_settings
from app.correlation import (
    CORRELATION_ID_HEADER,
    parse_correlation_id,
    received_at_iso,
)

logger = logging.getLogger(__name__)

# Reject oversized bodies early (DoS). Auth still runs after this for /v1.
MAX_BODY_BYTES = int(os.getenv("BUDGET_MAX_BODY_BYTES", str(2 * 1024 * 1024)))


def _configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    _configure_logging(settings.log_level)
    logging.getLogger(__name__).info(
        "Budget App starting on %s:%s",
        settings.app_host,
        settings.app_port,
    )
    yield
    logging.getLogger(__name__).info("Budget App shutting down")


def create_app() -> FastAPI:
    docs_enabled = os.getenv("BUDGET_ENABLE_DOCS", "").strip().lower() in {
        "1",
        "true",
        "yes",
    }
    app = FastAPI(
        title="Budget App",
        description="Personal budgeting API with enterprise security controls",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
    )

    @app.middleware("http")
    async def body_size_and_logging_middleware(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                if int(content_length) > MAX_BODY_BYTES:
                    return JSONResponse(
                        status_code=413,
                        content={
                            "detail": f"Request body exceeds {MAX_BODY_BYTES} bytes"
                        },
                    )
            except ValueError:
                return JSONResponse(
                    status_code=400,
                    content={"detail": "Invalid Content-Length"},
                )

        correlation_id = parse_correlation_id(request.headers)
        received_at = received_at_iso()
        request.state.correlation_id = correlation_id
        request.state.received_at = received_at

        started_at = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            elapsed_ms = (time.perf_counter() - started_at) * 1000
            logger.exception(
                "request_failed method=%s path=%s elapsed_ms=%.2f "
                "correlation_id=%s received_at=%s",
                request.method,
                request.url.path,
                elapsed_ms,
                correlation_id,
                received_at,
            )
            raise

        elapsed_ms = (time.perf_counter() - started_at) * 1000
        response.headers[CORRELATION_ID_HEADER] = correlation_id
        logger.info(
            "request_completed method=%s path=%s status_code=%s elapsed_ms=%.2f "
            "correlation_id=%s received_at=%s",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
            correlation_id,
            received_at,
        )
        return response

    app.include_router(health_router)
    app.include_router(accounts_router)
    return app


app = create_app()
