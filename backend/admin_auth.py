"""Admin OTP auth flow — separate from regular user auth.

Rules enforced:
1. Admin registration only allowed for @<ADMIN_ALLOWED_DOMAIN> emails.
2. OTP is emailed to OTP_TO_EMAIL (admin@citetail.com), NEVER to the registering user.
3. Admin sessions are valid ADMIN_SESSION_DAYS (30) days; after that the admin
   must reset the password. Password reset requires an OTP delivered to
   OTP_TO_EMAIL as well.
"""
from __future__ import annotations

import os
import asyncio
import logging
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
import resend
from bson import ObjectId
from fastapi import APIRouter, Request, Response, HTTPException, Depends
from pydantic import BaseModel, EmailStr, Field

logger = logging.getLogger(__name__)

# ---------- Config (env-driven; never hardcode) ----------
ADMIN_ALLOWED_DOMAIN = os.environ.get("ADMIN_ALLOWED_DOMAIN", "citetail.com").lower()
OTP_TO_EMAIL = os.environ.get("OTP_TO_EMAIL", "admin@citetail.com").lower()
OTP_FROM_EMAIL = os.environ.get("OTP_FROM_EMAIL", "onboarding@resend.dev")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
ADMIN_SESSION_DAYS = int(os.environ.get("ADMIN_SESSION_DAYS", "30"))
OTP_TTL_MIN = 10
OTP_RESEND_COOLDOWN_SEC = 60

if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY

admin_router = APIRouter(prefix="/api/admin")


# ---------- Helpers (bcrypt/jwt/cookies live in server.py; import lazily to avoid cycles) ----------
def _server():
    import server  # local import
    return server


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(s: str) -> str:
    return bcrypt.hashpw(s.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def _validate_admin_email(email: str):
    if "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email")
    dom = email.split("@", 1)[1].lower()
    if dom != ADMIN_ALLOWED_DOMAIN:
        raise HTTPException(status_code=403, detail=f"Admin registration is restricted to @{ADMIN_ALLOWED_DOMAIN} emails only")


def _new_otp() -> str:
    return f"{secrets.randbelow(1000000):06d}"


async def _send_otp_email(otp: str, purpose: str, requester_email: str) -> None:
    """Deliver OTP to OTP_TO_EMAIL (admin inbox). Non-blocking via to_thread.

    If Resend is misconfigured we log the OTP so ops can retrieve it; we never
    surface the OTP to the API caller (that would defeat the flow)."""
    subject = f"Citetail admin — OTP for {purpose}"
    html = f"""
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:auto;padding:24px;color:#0f172a">
      <h2 style="margin:0 0 8px">Citetail admin verification</h2>
      <p style="margin:0 0 16px;color:#475569">A request was made to <b>{purpose}</b> for admin account
      <b>{requester_email}</b>. If you did not initiate this, ignore this email.</p>
      <div style="background:#f1f5f9;border-radius:12px;padding:20px;text-align:center;margin:16px 0">
        <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#64748b">Your OTP</div>
        <div style="font-size:36px;font-weight:800;letter-spacing:.3em;margin-top:6px">{otp}</div>
      </div>
      <p style="font-size:12px;color:#64748b;margin:0">Valid for {OTP_TTL_MIN} minutes. Do not share this code.</p>
    </div>
    """
    if not RESEND_API_KEY:
        logger.warning(f"[admin-otp] RESEND_API_KEY missing — OTP for {requester_email} ({purpose}): {otp}")
        return
    params = {"from": OTP_FROM_EMAIL, "to": [OTP_TO_EMAIL], "subject": subject, "html": html}
    try:
        res = await asyncio.to_thread(resend.Emails.send, params)
        logger.info(f"[admin-otp] sent {purpose} OTP to {OTP_TO_EMAIL} (resend id={res.get('id') if isinstance(res, dict) else res})")
    except Exception as e:
        # Log the code so admin can still complete flow if email transport is broken
        logger.error(f"[admin-otp] resend failed: {e}. OTP for {requester_email} ({purpose}): {otp}")


# ---------- Pydantic models ----------
class AdminRegisterInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str = Field(min_length=1, max_length=80)


class AdminOtpVerify(BaseModel):
    otp: str = Field(min_length=6, max_length=6)


class AdminLoginInput(BaseModel):
    email: EmailStr
    password: str


class AdminResetRequestInput(BaseModel):
    email: EmailStr


class AdminResetVerifyInput(BaseModel):
    email: EmailStr
    otp: str = Field(min_length=6, max_length=6)
    new_password: str = Field(min_length=8)


# ---------- DB collection accessors ----------
def _users():
    return _server().db.users


def _otps():
    return _server().db.admin_otps


async def _ensure_ttl_index():
    """expires_at doc field will auto-delete via TTL index on 'expires_at'."""
    await _otps().create_index("expires_at", expireAfterSeconds=0)
    await _otps().create_index([("email", 1), ("purpose", 1)])


# ---------- Cookie helper (30-day admin session) ----------
def _set_admin_cookies(response: Response, user_id: str, email: str):
    srv = _server()
    minutes = ADMIN_SESSION_DAYS * 24 * 60
    access = srv.create_access_token(user_id, email, minutes=minutes)
    refresh = srv.create_refresh_token(user_id, days=ADMIN_SESSION_DAYS)
    max_age = ADMIN_SESSION_DAYS * 86400
    response.set_cookie("access_token", access, httponly=True, secure=True, samesite="none", max_age=max_age, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=True, samesite="none", max_age=max_age, path="/")


# ---------- Rate limit helper ----------
async def _cooldown_check(email: str, purpose: str):
    latest = await _otps().find_one({"email": email, "purpose": purpose}, sort=[("created_at", -1)])
    if latest:
        created = latest["created_at"]
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        elapsed = (_now() - created).total_seconds()
        if elapsed < OTP_RESEND_COOLDOWN_SEC:
            raise HTTPException(status_code=429, detail=f"Please wait {int(OTP_RESEND_COOLDOWN_SEC - elapsed)}s before requesting another OTP")


# ---------- Endpoints ----------
@admin_router.post("/register/request-otp")
async def admin_register_request_otp(body: AdminRegisterInput):
    """Step 1 of admin registration. Emails OTP to admin@citetail.com.

    Rejects if the email domain isn't the allowed admin domain, or the email
    already belongs to a registered user."""
    email = body.email.lower().strip()
    _validate_admin_email(email)
    if await _users().find_one({"email": email}):
        raise HTTPException(status_code=400, detail="This email is already registered")
    await _ensure_ttl_index()
    await _cooldown_check(email, "register")

    otp = _new_otp()
    doc = {
        "email": email,
        "purpose": "register",
        "otp_hash": _hash(otp),
        "pending": {
            "email": email,
            "password_hash": _hash(body.password),
            "name": body.name.strip(),
        },
        "attempts": 0,
        "created_at": _now(),
        "expires_at": _now() + timedelta(minutes=OTP_TTL_MIN),
    }
    # Overwrite any prior register OTP for this email so only the latest is valid
    await _otps().delete_many({"email": email, "purpose": "register"})
    await _otps().insert_one(doc)
    await _send_otp_email(otp, "new admin registration", email)
    return {"ok": True, "delivered_to": OTP_TO_EMAIL, "expires_in": OTP_TTL_MIN * 60}


@admin_router.post("/register/verify-otp")
async def admin_register_verify_otp(body: AdminOtpVerify, response: Response):
    """Step 2 of admin registration. Consumes OTP, creates the admin user, sets 30-day session."""
    # We need the email to look up the OTP; we accept it from the pending record
    # (the frontend keeps the email in state, but we make this robust: verify
    # against ANY unexpired 'register' OTP whose otp matches).
    # To avoid iterating everything, we require the OTP + we look up by TTL.
    cutoff = _now()
    otp_doc = await _otps().find_one({
        "purpose": "register",
        "expires_at": {"$gt": cutoff.replace(tzinfo=None)},
    }, sort=[("created_at", -1)])
    if not otp_doc or not _verify(body.otp, otp_doc["otp_hash"]):
        # Increment attempts on the most recent one
        if otp_doc:
            await _otps().update_one({"_id": otp_doc["_id"]}, {"$inc": {"attempts": 1}})
            if otp_doc.get("attempts", 0) + 1 >= 5:
                await _otps().delete_one({"_id": otp_doc["_id"]})
        raise HTTPException(status_code=400, detail="Invalid or expired OTP")

    pending = otp_doc["pending"]
    email = pending["email"]
    if await _users().find_one({"email": email}):
        await _otps().delete_one({"_id": otp_doc["_id"]})
        raise HTTPException(status_code=400, detail="This email is already registered")

    now_iso = _now().isoformat()
    user_doc = {
        "email": email,
        "password_hash": pending["password_hash"],
        "name": pending["name"],
        "role": "admin",
        "created_at": now_iso,
        "password_set_at": now_iso,
        "admin_verified": True,
    }
    res = await _users().insert_one(user_doc)
    await _otps().delete_one({"_id": otp_doc["_id"]})
    uid = str(res.inserted_id)
    _set_admin_cookies(response, uid, email)
    return _server().apply_entitlements({"id": uid, "email": email, "name": pending["name"], "role": "admin"})


@admin_router.post("/login")
async def admin_login(body: AdminLoginInput, response: Response):
    """Admin-only login. Enforces 30-day password rotation."""
    email = body.email.lower().strip()
    user = await _users().find_one({"email": email})
    if not user or not _verify(body.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Not an admin account. Use the standard sign-in.")
    # 30-day rotation check
    password_set_at = user.get("password_set_at") or user.get("created_at")
    try:
        pset = datetime.fromisoformat(password_set_at.replace("Z", "+00:00")) if isinstance(password_set_at, str) else password_set_at
        if pset.tzinfo is None:
            pset = pset.replace(tzinfo=timezone.utc)
    except Exception:
        pset = _now()
    if _now() - pset > timedelta(days=ADMIN_SESSION_DAYS):
        raise HTTPException(status_code=403, detail="password_reset_required")
    uid = str(user["_id"])
    _set_admin_cookies(response, uid, email)
    return _server().apply_entitlements({
        "id": uid, "email": email, "name": user.get("name", "Admin"), "role": "admin",
    })


@admin_router.post("/password-reset/request-otp")
async def admin_reset_request_otp(body: AdminResetRequestInput):
    """Send OTP to admin@citetail.com so a rotation can be authorized."""
    email = body.email.lower().strip()
    _validate_admin_email(email)
    user = await _users().find_one({"email": email})
    if not user or user.get("role") != "admin":
        # Do not reveal existence — but this is admin-only flow so we can be explicit
        raise HTTPException(status_code=404, detail="No admin account for that email")
    await _ensure_ttl_index()
    await _cooldown_check(email, "reset")
    otp = _new_otp()
    await _otps().delete_many({"email": email, "purpose": "reset"})
    await _otps().insert_one({
        "email": email,
        "purpose": "reset",
        "otp_hash": _hash(otp),
        "attempts": 0,
        "created_at": _now(),
        "expires_at": _now() + timedelta(minutes=OTP_TTL_MIN),
    })
    await _send_otp_email(otp, "admin password reset", email)
    return {"ok": True, "delivered_to": OTP_TO_EMAIL, "expires_in": OTP_TTL_MIN * 60}


@admin_router.post("/password-reset/verify-otp")
async def admin_reset_verify_otp(body: AdminResetVerifyInput, response: Response):
    email = body.email.lower().strip()
    _validate_admin_email(email)
    otp_doc = await _otps().find_one({"email": email, "purpose": "reset", "expires_at": {"$gt": _now().replace(tzinfo=None)}}, sort=[("created_at", -1)])
    if not otp_doc or not _verify(body.otp, otp_doc["otp_hash"]):
        if otp_doc:
            await _otps().update_one({"_id": otp_doc["_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="Invalid or expired OTP")
    user = await _users().find_one({"email": email})
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=404, detail="No admin account for that email")
    now_iso = _now().isoformat()
    await _users().update_one({"_id": user["_id"]}, {"$set": {
        "password_hash": _hash(body.new_password),
        "password_set_at": now_iso,
    }})
    await _otps().delete_one({"_id": otp_doc["_id"]})
    uid = str(user["_id"])
    _set_admin_cookies(response, uid, email)
    return _server().apply_entitlements({
        "id": uid, "email": email, "name": user.get("name", "Admin"), "role": "admin",
    })


@admin_router.get("/config")
async def admin_config():
    """Public config for the admin auth pages (safe to expose)."""
    return {
        "allowed_domain": ADMIN_ALLOWED_DOMAIN,
        "otp_delivered_to": OTP_TO_EMAIL,
        "session_days": ADMIN_SESSION_DAYS,
        "otp_ttl_seconds": OTP_TTL_MIN * 60,
    }
