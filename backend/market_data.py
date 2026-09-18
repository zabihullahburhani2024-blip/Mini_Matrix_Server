"""
Twelve Data WebSocket client + in-memory market state.
Maintains exactly ONE connection to Twelve Data and broadcasts
normalized price updates to all connected Mini Matrix clients.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Set

import websockets
from websockets.exceptions import ConnectionClosed

from config import get_settings

logger = logging.getLogger("market_data")


@dataclass
class MarketSnapshot:
    symbol: str = "XAU/USD"
    price: Optional[float] = None
    timestamp: Optional[int] = None  # unix seconds from provider
    received_at: float = 0.0  # local monotonic / wall time
    source: str = "Twelve Data"
    update_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "market_update",
            "symbol": self.symbol,
            "price": self.price,
            "timestamp": self.timestamp,
            "received_at": self.received_at,
            "source": self.source,
            "update_count": self.update_count,
        }


@dataclass
class ConnectionStats:
    td_connected: bool = False
    td_last_connect: float = 0.0
    td_last_reconnect: float = 0.0
    td_reconnect_count: int = 0
    client_count: int = 0
    messages_received: int = 0
    last_error: str = ""


class MarketDataService:
    """
    Singleton service:
    - One outbound WebSocket to Twelve Data
    - Automatic reconnect with exponential backoff
    - In-memory latest price
    - Fan-out to internal client set
    """

    def __init__(self) -> None:
        self.settings = get_settings()
        self.snapshot = MarketSnapshot(symbol=self.settings.symbol)
        self.stats = ConnectionStats()
        self._clients: Set[Any] = set()  # FastAPI WebSocket objects
        self._td_task: Optional[asyncio.Task] = None
        self._stop = asyncio.Event()
        self._lock = asyncio.Lock()
        self._on_price: Optional[Callable[[MarketSnapshot], None]] = None

    # ------------------------------------------------------------------
    # Client management
    # ------------------------------------------------------------------
    async def register_client(self, ws: Any) -> bool:
        async with self._lock:
            if len(self._clients) >= self.settings.max_clients:
                return False
            self._clients.add(ws)
            self.stats.client_count = len(self._clients)
            return True

    async def unregister_client(self, ws: Any) -> None:
        async with self._lock:
            self._clients.discard(ws)
            self.stats.client_count = len(self._clients)

    async def broadcast(self, message: dict) -> None:
        if not self._clients:
            return
        data = json.dumps(message, separators=(",", ":"))
        dead = []
        for ws in list(self._clients):
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.unregister_client(ws)

    def get_status(self) -> dict:
        return {
            "type": "status",
            "td_connected": self.stats.td_connected,
            "client_count": self.stats.client_count,
            "update_count": self.snapshot.update_count,
            "messages_received": self.stats.messages_received,
            "last_price": self.snapshot.price,
            "last_timestamp": self.snapshot.timestamp,
            "last_received_at": self.snapshot.received_at,
            "td_reconnect_count": self.stats.td_reconnect_count,
            "last_error": self.stats.last_error,
            "symbol": self.snapshot.symbol,
        }

    # ------------------------------------------------------------------
    # Twelve Data connection loop
    # ------------------------------------------------------------------
    async def start(self) -> None:
        if self._td_task and not self._td_task.done():
            return
        self._stop.clear()
        self._td_task = asyncio.create_task(self._run_td_loop(), name="td-ws-loop")
        logger.info("MarketDataService started")

    async def stop(self) -> None:
        self._stop.set()
        if self._td_task:
            self._td_task.cancel()
            try:
                await self._td_task
            except asyncio.CancelledError:
                pass
            self._td_task = None
        self.stats.td_connected = False
        logger.info("MarketDataService stopped")

    async def _run_td_loop(self) -> None:
        backoff = 1.0
        max_backoff = 60.0
        while not self._stop.is_set():
            try:
                await self._connect_and_listen()
                backoff = 1.0  # reset on clean exit
            except asyncio.CancelledError:
                break
            except Exception as exc:
                self.stats.td_connected = False
                self.stats.last_error = str(exc)
                logger.warning("TD connection error: %s — reconnect in %.1fs", exc, backoff)
                self.stats.td_reconnect_count += 1
                self.stats.td_last_reconnect = time.time()
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=backoff)
                    break
                except asyncio.TimeoutError:
                    pass
                backoff = min(backoff * 2, max_backoff)

    async def _connect_and_listen(self) -> None:
        key = self.settings.twelve_data_api_key
        if not key:
            raise RuntimeError("TWELVE_DATA_API_KEY is not set")

        url = f"{self.settings.td_ws_url}?apikey={key}"
        logger.info("Connecting to Twelve Data WebSocket…")

        async with websockets.connect(
            url,
            ping_interval=20,
            ping_timeout=20,
            close_timeout=5,
            max_size=2**20,
        ) as ws:
            self.stats.td_connected = True
            self.stats.td_last_connect = time.time()
            self.stats.last_error = ""
            logger.info("Connected to Twelve Data")

            # Subscribe to XAU/USD
            sub = {
                "action": "subscribe",
                "params": {"symbols": self.settings.symbol},
            }
            await ws.send(json.dumps(sub))
            logger.info("Subscribed to %s", self.settings.symbol)

            # Send initial status to clients
            await self.broadcast(self.get_status())

            async for raw in ws:
                if self._stop.is_set():
                    break
                await self._handle_td_message(raw)

    async def _handle_td_message(self, raw: str | bytes) -> None:
        try:
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8")
            msg = json.loads(raw)
        except Exception as exc:
            logger.debug("Malformed TD message: %s", exc)
            return

        self.stats.messages_received += 1
        event = msg.get("event")

        if event == "price":
            symbol = msg.get("symbol") or ""
            if symbol != self.settings.symbol:
                return
            price = msg.get("price")
            try:
                price_f = float(price)
            except (TypeError, ValueError):
                logger.warning("Invalid price in TD message: %s", price)
                return
            if price_f <= 0:
                return

            ts = msg.get("timestamp")
            try:
                ts_i = int(ts) if ts is not None else int(time.time())
            except (TypeError, ValueError):
                ts_i = int(time.time())

            self.snapshot.price = price_f
            self.snapshot.timestamp = ts_i
            self.snapshot.received_at = time.time()
            self.snapshot.update_count += 1

            payload = self.snapshot.to_dict()
            await self.broadcast(payload)
            logger.debug("Price update: %.4f (#%d)", price_f, self.snapshot.update_count)

        elif event in ("subscribe-status", "heartbeat", "status"):
            logger.debug("TD event: %s", event)
        else:
            # heartbeat from library or unknown
            if msg.get("status") == "error":
                self.stats.last_error = msg.get("message", "unknown TD error")
                logger.warning("TD error event: %s", msg)


# Global singleton
market_service = MarketDataService()
