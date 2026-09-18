"""
Mini Matrix Backend
-------------------
One Twelve Data WebSocket connection → broadcast live XAU/USD
to all connected Mini Matrix mobile / web clients.

Endpoints:
  GET  /                 Health + short info
  GET  /health           Health check
  GET  /api/status       Current market + connection stats
  GET  /api/price        Latest price snapshot (REST fallback)
  WS   /ws               Live market stream for clients
  POST /api/auth/*       Register, login, activate, reset-password
"""
from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import get_settings
from market_data import market_service
import database as db
from auth import router as auth_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    if not settings.twelve_data_api_key:
        logger.error("TWELVE_DATA_API_KEY is empty — set it in .env")
    db.init_db()
    logger.info("Database ready")
    await market_service.start()
    logger.info("Backend ready — max clients=%d", settings.max_clients)
    yield
    await market_service.stop()
    logger.info("Backend shut down")


app = FastAPI(
    title="Mini Matrix Backend",
    version="1.1.0",
    description="Live XAU/USD + secure auth for Mini Matrix gold calculator",
    lifespan=lifespan,
)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)


@app.get("/")
async def root():
    return {
        "service": "Mini Matrix Backend",
        "version": "1.0.0",
        "symbol": settings.symbol,
        "docs": "/docs",
        "ws": "/ws",
    }


@app.get("/health")
async def health():
    st = market_service.get_status()
    ok = st["td_connected"] or st["last_price"] is not None
    return JSONResponse(
        status_code=200 if ok else 503,
        content={
            "status": "ok" if ok else "degraded",
            "td_connected": st["td_connected"],
            "has_price": st["last_price"] is not None,
            "clients": st["client_count"],
        },
    )


@app.get("/api/status")
async def api_status():
    return market_service.get_status()


@app.get("/api/price")
async def api_price():
    snap = market_service.snapshot
    if snap.price is None:
        return JSONResponse(
            status_code=503,
            content={"error": "no price yet", "message": "Waiting for first Twelve Data update"},
        )
    return snap.to_dict()


def _check_token(token: Optional[str]) -> bool:
    expected = settings.client_token
    if not expected:
        return True  # open for local / trial
    return token == expected


@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
):
    """
    Client WebSocket.
    Protocol:
      - Server immediately sends current status + last price (if any)
      - Then pushes {"type":"market_update", ...} on every price change
      - Client may send {"type":"ping"} → server replies {"type":"pong"}
    """
    if not _check_token(token):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    ok = await market_service.register_client(websocket)
    if not ok:
        await websocket.send_json(
            {"type": "error", "message": "max clients reached"}
        )
        await websocket.close(code=status.WS_1013_TRY_AGAIN_LATER)
        return

    logger.info("Client connected (total=%d)", market_service.stats.client_count)

    try:
        # Send current state right away
        await websocket.send_json(market_service.get_status())
        if market_service.snapshot.price is not None:
            await websocket.send_json(market_service.snapshot.to_dict())

        while True:
            try:
                data = await websocket.receive_json()
            except Exception:
                # binary / empty / disconnect
                break
            if isinstance(data, dict) and data.get("type") == "ping":
                await websocket.send_json({"type": "pong", "t": time.time()})
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.debug("Client error: %s", exc)
    finally:
        await market_service.unregister_client(websocket)
        logger.info("Client disconnected (total=%d)", market_service.stats.client_count)


if __name__ == "__main__":
    import uvicorn

    s = get_settings()
    uvicorn.run(
        "main:app",
        host=s.host,
        port=s.port,
        log_level=s.log_level.lower(),
        reload=False,
    )
