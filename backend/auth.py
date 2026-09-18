"""
Server-side authentication, registration, activation & password recovery.
Passwords are hashed with bcrypt. Activation codes are one-time and stored in DB.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import time
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Header, status
from pydantic import BaseModel, Field

import database as db

logger = logging.getLogger("auth")

router = APIRouter(prefix="/api/auth", tags=["auth"])

ACTIVATION_DAYS = 365
# Simple token for session (production: use JWT with secret)
SESSION_SECRET = secrets.token_hex(32)  # regenerated on restart — fine for this use


# ── Password hashing (bcrypt if available, else PBKDF2) ─────────────────────

def _hash_password(password: str) -> str:
    try:
        import bcrypt
        return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
    except ImportError:
        salt = secrets.token_hex(16)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode(), 120_000)
        return f"pbkdf2:{salt}:{dk.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        import bcrypt
        if stored.startswith("$2"):  # bcrypt
            return bcrypt.checkpw(password.encode("utf-8"), stored.encode("utf-8"))
    except ImportError:
        pass
    if stored.startswith("pbkdf2:"):
        _, salt, hexhash = stored.split(":", 2)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode(), 120_000)
        return hmac.compare_digest(dk.hex(), hexhash)
    # legacy client-side style hash (migration)
    h = 0
    for ch in password:
        h = ((h << 5) - h) + ord(ch)
        h &= 0xFFFFFFFF
        if h >= 0x80000000:
            h -= 0x100000000
    return str(h) == stored


def _make_token(phone: str) -> str:
    """Lightweight signed token: phone|expiry|sig"""
    exp = int(time.time()) + 30 * 86400  # 30 days
    payload = f"{phone}|{exp}"
    sig = hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{payload}|{sig}"


def _verify_token(token: str) -> Optional[str]:
    try:
        parts = token.split("|")
        if len(parts) != 3:
            return None
        phone, exp_s, sig = parts
        payload = f"{phone}|{exp_s}"
        expected = hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(sig, expected):
            return None
        if int(exp_s) < time.time():
            return None
        return phone
    except Exception:
        return None


def _user_public(u: dict[str, Any]) -> dict[str, Any]:
    """Safe fields for client (never send pass_hash / recovery)."""
    activated = bool(u.get("activated"))
    expires_at = u.get("expires_at")
    if activated and expires_at and time.time() > float(expires_at):
        activated = False
        try:
            db.set_user_expired(u["phone"])
        except Exception:
            pass
    return {
        "phone": u["phone"],
        "name": u["name"],
        "activated": activated,
        "expires_at": expires_at,
        "created_at": u.get("created_at"),
    }


# ── Request / Response models ───────────────────────────────────────────────

class RegisterIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    phone: str = Field(..., min_length=8, max_length=20)
    password: str = Field(..., min_length=4, max_length=128)
    recovery: str = Field("", max_length=120)


class LoginIn(BaseModel):
    phone: str
    password: str


class ActivateIn(BaseModel):
    phone: str
    code: str = Field(..., min_length=16, max_length=48)


class ResetIn(BaseModel):
    phone: str
    recovery: str
    new_password: str = Field(..., min_length=4, max_length=128)


# ── Routes ──────────────────────────────────────────────────────────────────

@router.post("/register")
async def register(body: RegisterIn):
    phone = db._norm_phone(body.phone)
    if len(phone) < 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="invalid_input")
    if not body.name.strip() or len(body.password) < 4:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="invalid_input")

    try:
        user = db.create_user(
            phone=phone,
            name=body.name,
            pass_hash=_hash_password(body.password),
            recovery=body.recovery or "",
        )
    except ValueError as e:
        if str(e) == "exists":
            raise HTTPException(status.HTTP_409_CONFLICT, detail="exists")
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(e))

    logger.info("User registered: %s", phone)
    return {"ok": True, "phone": phone, "name": user["name"]}


@router.post("/login")
async def login(body: LoginIn):
    user = db.find_user_by_phone(body.phone)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="not_found")
    if not _verify_password(body.password, user["pass_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="bad_password")

    pub = _user_public(user)
    token = _make_token(user["phone"])
    return {
        "ok": True,
        "token": token,
        "user": pub,
    }


@router.post("/activate")
async def activate(body: ActivateIn):
    phone = db._norm_phone(body.phone)
    code = body.code.strip().lower()

    user = db.find_user_by_phone(phone)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="not_found")

    expires_at = time.time() + ACTIVATION_DAYS * 86400
    try:
        db.activate_user(phone, code, expires_at)
    except ValueError as e:
        err = str(e)
        if err == "already_used":
            raise HTTPException(status.HTTP_409_CONFLICT, detail="already_used")
        if err == "not_in_pool":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="not_in_pool")
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=err)

    logger.info("Activated phone=%s code=%s…", phone, code[:8])
    token = _make_token(phone)
    return {
        "ok": True,
        "expires_at": expires_at,
        "days": ACTIVATION_DAYS,
        "token": token,
        "user": {
            "phone": phone,
            "name": user["name"],
            "activated": True,
            "expires_at": expires_at,
        },
    }


@router.post("/reset-password")
async def reset_password(body: ResetIn):
    user = db.find_user_by_phone(body.phone)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="not_found")
    if not user.get("recovery") or user["recovery"] != body.recovery.strip():
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="bad_recovery")
    if len(body.new_password) < 4:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="weak_password")

    db.update_user_password(user["phone"], _hash_password(body.new_password))
    logger.info("Password reset for %s", user["phone"])
    return {"ok": True}


@router.get("/me")
async def me(authorization: Optional[str] = Header(None)):
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="no_token")

    phone = _verify_token(token)
    if not phone:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="invalid_token")

    user = db.find_user_by_phone(phone)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="not_found")

    return {"ok": True, "user": _user_public(user)}


@router.get("/stats")
async def stats():
    """Public pool stats (no sensitive data)."""
    return db.code_stats()
