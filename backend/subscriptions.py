"""Subscription flow — plan-based access control + Stripe one-off payments
that grant 30 days of access each. On successful payment the user's
`plan_expires_at` is extended by 30 days (webhook or status poll — whichever
lands first, both are idempotent). Failures leave the user in
`status="pending_payment"`. Cancellations are handled by simply letting the
current window expire.

Why not Stripe recurring subscriptions? The shared sandbox key ships with the
pod (`sk_test_emergent`) only supports `mode="payment"` via the emergent
integration library — subscription-mode checkout requires a claimable sandbox,
which is not available for the current account country. Everything else in
the spec (activation, extension, feature/project limits, upgrade lock UI)
works exactly the same either way.
"""
from __future__ import annotations

import os
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field

from emergentintegrations.payments.stripe.checkout import (
    StripeCheckout, CheckoutSessionRequest, CheckoutSessionResponse,
    CheckoutStatusResponse,
)

logger = logging.getLogger(__name__)

STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "sk_test_emergent")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET") or None  # optional

# ---------- Plan catalogue (server-side; frontend fetches via /plans) ----------
FEATURE_DOMAIN = "domain"
FEATURE_AEO = "aeo"          # Content Optimizer / Answer Engine Optimization
FEATURE_AGENT = "agent"
FEATURE_VISIBILITY = "visibility"
FEATURE_CITATIONS = "citations"
FEATURE_SENTIMENT = "sentiment"
FEATURE_REDDIT = "reddit"
FEATURE_BRAND = "brand"
FEATURE_PR = "pr"

ALL_FEATURES = [FEATURE_DOMAIN, FEATURE_AEO, FEATURE_AGENT, FEATURE_VISIBILITY,
                FEATURE_CITATIONS, FEATURE_SENTIMENT, FEATURE_REDDIT, FEATURE_BRAND, FEATURE_PR]

PLANS: Dict[str, Dict[str, Any]] = {
    "starter": {
        "slug": "starter",
        "name": "Starter",
        "price_usd": 49.0,
        "project_limit": 1,
        "features": [FEATURE_DOMAIN, FEATURE_AEO, FEATURE_AGENT],
        "tagline": "Solo founders shipping their first AI-visible page",
        "highlights": [
            "1 project",
            "Domain Analysis",
            "Answer Engine Optimizer (AEO)",
            "AI Agent (chat assistant)",
        ],
    },
    "growth": {
        "slug": "growth",
        "name": "Growth",
        "price_usd": 99.0,
        "project_limit": 3,
        "features": ALL_FEATURES,
        "tagline": "Growing teams tracking multiple brands across AI answers",
        "highlights": [
            "Up to 3 projects",
            "Everything in Starter",
            "Visibility Tracker · Citation Sources",
            "Sentiment · Reddit · Brand · PR Coverage",
        ],
    },
    "pro": {
        "slug": "pro",
        "name": "Pro",
        "price_usd": 199.0,
        "project_limit": 10,
        "features": ALL_FEATURES,
        "tagline": "Agencies & platform teams managing many brands",
        "highlights": [
            "Up to 10 projects",
            "Everything in Growth",
            "Priority scan queue",
            "White-glove onboarding",
        ],
    },
}

ACCESS_GRANT_DAYS = 30

subs_router = APIRouter(prefix="/api/subscriptions")
stripe_webhook_router = APIRouter()  # mounted at /api


# ---------- helpers ----------
def _server():
    import server
    return server


def _now():
    return datetime.now(timezone.utc)


def _to_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _parse_dt(v) -> Optional[datetime]:
    if not v:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except Exception:
        return None


def plan_of(user: dict) -> Optional[dict]:
    slug = (user or {}).get("plan")
    return PLANS.get(slug) if slug else None


def is_active(user: dict) -> bool:
    """Admins bypass. Otherwise the user must have a paid plan whose window hasn't closed."""
    if not user:
        return False
    if user.get("role") == "admin" or user.get("full_access"):
        return True
    if user.get("subscription_status") != "active":
        return False
    exp = _parse_dt(user.get("plan_expires_at"))
    if not exp:
        return False
    return exp > _now()


def user_features(user: dict) -> list:
    if user.get("role") == "admin" or user.get("full_access"):
        return ALL_FEATURES
    p = plan_of(user)
    return p["features"] if p and is_active(user) else []


def entitlements_for(user: dict) -> dict:
    p = plan_of(user)
    exp = _parse_dt(user.get("plan_expires_at"))
    days_left = max(0, int((exp - _now()).total_seconds() // 86400)) if exp else 0
    return {
        "plan": p["slug"] if p else None,
        "plan_name": p["name"] if p else None,
        "project_limit": p["project_limit"] if p else 0,
        "features": user_features(user),
        "subscription_status": user.get("subscription_status", "none"),
        "plan_expires_at": _to_iso(exp) if exp else None,
        "days_remaining": days_left,
        "is_active": is_active(user),
    }


def require_feature(feature: str):
    """FastAPI dependency: block requests to endpoints not covered by the caller's plan."""
    async def _dep(user: dict = Depends(_server_get_current_user)):
        if feature not in user_features(user):
            raise HTTPException(status_code=402, detail={
                "code": "feature_locked",
                "feature": feature,
                "message": f"'{feature}' is not included in your current plan. Upgrade to unlock.",
            })
        return user
    return _dep


async def _server_get_current_user(request: Request):
    return await _server().get_current_user(request)


# ---------- Stripe helpers ----------
def _stripe_client(webhook_url: Optional[str]) -> StripeCheckout:
    return StripeCheckout(api_key=STRIPE_API_KEY, webhook_secret=STRIPE_WEBHOOK_SECRET, webhook_url=webhook_url)


def _webhook_url(request: Request) -> str:
    # Public webhook path (see mount at /api/webhook/stripe)
    base = str(request.base_url).rstrip("/")
    return f"{base}/api/webhook/stripe"


def _origin(request: Request, override: Optional[str]) -> str:
    return (override or request.headers.get("origin") or str(request.base_url)).rstrip("/")


async def _create_checkout(user_id: str, plan_slug: str, purpose: str, origin: str, request: Request) -> dict:
    plan = PLANS[plan_slug]
    sc = _stripe_client(_webhook_url(request))
    req = CheckoutSessionRequest(
        amount=plan["price_usd"], currency="usd",
        success_url=f"{origin}/payment/success?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{origin}/payment/cancel?plan={plan_slug}",
        metadata={"user_id": user_id, "plan": plan_slug, "purpose": purpose},
    )
    res: CheckoutSessionResponse = await sc.create_checkout_session(req)
    tx = {
        "session_id": res.session_id,
        "user_id": user_id,
        "plan": plan_slug,
        "amount": plan["price_usd"],
        "currency": "usd",
        "purpose": purpose,  # register | upgrade | renew
        "status": "initiated",
        "payment_status": "pending",
        "created_at": _now(),
        "updated_at": _now(),
    }
    await _server().db.payment_transactions.insert_one(tx)
    return {"checkout_url": res.url, "session_id": res.session_id}


async def _grant_access(user_id: str, plan_slug: str, purpose: str):
    """Idempotent activation/extension. Called from webhook AND status poll —
    whichever wins first extends by 30 days; further calls for the same session
    are no-ops thanks to the transaction guard in the caller."""
    plan = PLANS.get(plan_slug)
    if not plan:
        logger.warning(f"grant_access: unknown plan '{plan_slug}'")
        return
    users = _server().db.users
    user = await users.find_one({"_id": ObjectId(user_id)})
    if not user:
        return
    now = _now()
    current_exp = _parse_dt(user.get("plan_expires_at"))
    # If active on same plan → EXTEND. Otherwise → start a fresh 30-day window.
    if user.get("plan") == plan_slug and current_exp and current_exp > now:
        new_exp = current_exp + timedelta(days=ACCESS_GRANT_DAYS)
    else:
        new_exp = now + timedelta(days=ACCESS_GRANT_DAYS)
    await users.update_one({"_id": ObjectId(user_id)}, {"$set": {
        "plan": plan_slug,
        "subscription_status": "active",
        "plan_started_at": _to_iso(now) if not user.get("plan_started_at") or user.get("plan") != plan_slug else user.get("plan_started_at"),
        "plan_expires_at": _to_iso(new_exp),
        "last_payment_at": _to_iso(now),
        "failed_payment_count": 0,
    }})
    logger.info(f"[subscriptions] {purpose} granted plan={plan_slug} to user={user_id} until {new_exp.isoformat()}")


async def _mark_failed(user_id: str):
    users = _server().db.users
    user = await users.find_one({"_id": ObjectId(user_id)})
    if not user:
        return
    count = int(user.get("failed_payment_count", 0)) + 1
    updates = {"failed_payment_count": count, "last_payment_failed_at": _to_iso(_now())}
    # 3 strikes: lock access (no grace)
    if count >= 3:
        updates["subscription_status"] = "past_due_locked"
        updates["plan_expires_at"] = _to_iso(_now() - timedelta(seconds=1))
    await users.update_one({"_id": ObjectId(user_id)}, {"$set": updates})
    logger.warning(f"[subscriptions] payment failed x{count} user={user_id}")


async def _cancel_at_period_end(user_id: str):
    """Subscription cancelled — keep access until plan_expires_at, then let it lapse."""
    await _server().db.users.update_one({"_id": ObjectId(user_id)}, {"$set": {
        "subscription_status": "cancel_at_period_end",
    }})


# ---------- Models ----------
class RegisterAndCheckoutInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: str = Field(min_length=6)
    plan: str
    origin_url: Optional[str] = None


class UpgradeInput(BaseModel):
    plan: str
    origin_url: Optional[str] = None


# ---------- Endpoints ----------
@subs_router.get("/plans")
async def list_plans():
    return {"plans": list(PLANS.values()), "access_grant_days": ACCESS_GRANT_DAYS}


@subs_router.post("/register-and-checkout")
async def register_and_checkout(body: RegisterAndCheckoutInput, request: Request):
    """Create the user record (status=pending_payment) and start Stripe checkout.

    If the email already exists AND is pending_payment, we allow retrying the
    checkout instead of returning an error — accounts stuck in 'pending' can
    click 'complete your payment' from the login page and end up here again.
    """
    srv = _server()
    if body.plan not in PLANS:
        raise HTTPException(status_code=400, detail="Unknown plan")
    email = body.email.lower().strip()
    existing = await srv.db.users.find_one({"email": email})
    if existing:
        if existing.get("subscription_status") in ("pending_payment", None) and not existing.get("plan_expires_at"):
            uid = str(existing["_id"])
            await srv.db.users.update_one({"_id": existing["_id"]}, {"$set": {"plan": body.plan}})
        else:
            raise HTTPException(status_code=400, detail="Email already registered — sign in instead")
    else:
        doc = {
            "email": email,
            "password_hash": srv.hash_password(body.password),
            "name": body.name.strip(),
            "role": "user",
            "created_at": _to_iso(_now()),
            "plan": body.plan,
            "subscription_status": "pending_payment",
        }
        res = await srv.db.users.insert_one(doc)
        uid = str(res.inserted_id)
    origin = _origin(request, body.origin_url)
    checkout = await _create_checkout(uid, body.plan, "register", origin, request)
    return {"user_id": uid, "email": email, **checkout}


@subs_router.post("/upgrade")
async def upgrade(body: UpgradeInput, request: Request, user: dict = Depends(_server_get_current_user)):
    """Upgrade / renew: authenticated user picks a plan and gets a fresh
    checkout session. On success their access window is extended by 30 days.
    Admin accounts bypass Stripe entirely."""
    if body.plan not in PLANS:
        raise HTTPException(status_code=400, detail="Unknown plan")
    if user.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Admin accounts already have full access")
    origin = _origin(request, body.origin_url)
    return await _create_checkout(user["id"], body.plan, "upgrade", origin, request)


@subs_router.get("/status/{session_id}")
async def status(session_id: str, request: Request):
    """Polled by /payment/success. Unauthenticated by design (matches playbook)."""
    srv = _server()
    tx = await srv.db.payment_transactions.find_one({"session_id": session_id})
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    if tx.get("payment_status") != "paid":
        try:
            sc = _stripe_client(_webhook_url(request))
            info: CheckoutStatusResponse = await sc.get_checkout_status(session_id)
            if info.payment_status == "paid" or info.status == "complete":
                # idempotent flip
                res = await srv.db.payment_transactions.update_one(
                    {"session_id": session_id, "payment_status": {"$ne": "paid"}},
                    {"$set": {"status": "completed", "payment_status": "paid", "updated_at": _now()}},
                )
                if res.modified_count:
                    await _grant_access(tx["user_id"], tx["plan"], tx.get("purpose", "register"))
                tx = await srv.db.payment_transactions.find_one({"session_id": session_id})
            elif info.status in ("expired",):
                await srv.db.payment_transactions.update_one({"session_id": session_id},
                    {"$set": {"status": "expired", "payment_status": "expired", "updated_at": _now()}})
                tx = await srv.db.payment_transactions.find_one({"session_id": session_id})
        except Exception as e:
            logger.warning(f"[subscriptions] stripe status poll failed for {session_id}: {e}")

    return {
        "session_id": tx["session_id"],
        "status": tx["status"],
        "payment_status": tx["payment_status"],
        "plan": tx.get("plan"),
    }


@stripe_webhook_router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    """Idempotent webhook handler. Handles:
      - checkout.session.completed / async_payment_succeeded → activate/extend
      - checkout.session.async_payment_failed / expired → mark failure
      - customer.subscription.deleted → cancel at period end
    The `emergentintegrations` library normalises signature verification when
    STRIPE_WEBHOOK_SECRET is set."""
    srv = _server()
    payload = await request.body()
    sig = request.headers.get("stripe-signature") or request.headers.get("Stripe-Signature")
    try:
        sc = _stripe_client(_webhook_url(request))
        evt = await sc.handle_webhook(payload, sig)
    except Exception as e:
        logger.warning(f"[stripe-webhook] verification failed: {e}")
        raise HTTPException(status_code=400, detail="Invalid webhook payload")

    et = evt.event_type
    sid = evt.session_id
    meta = evt.metadata or {}
    user_id = meta.get("user_id")
    plan = meta.get("plan")
    purpose = meta.get("purpose", "register")

    logger.info(f"[stripe-webhook] type={et} session={sid} user={user_id} plan={plan}")

    if et in ("checkout.session.completed", "checkout.session.async_payment_succeeded", "payment_intent.succeeded"):
        if sid:
            res = await srv.db.payment_transactions.update_one(
                {"session_id": sid, "payment_status": {"$ne": "paid"}},
                {"$set": {"status": "completed", "payment_status": "paid", "updated_at": _now()}},
            )
            if res.modified_count and user_id and plan:
                await _grant_access(user_id, plan, purpose)
    elif et in ("checkout.session.async_payment_failed", "payment_intent.payment_failed"):
        if sid:
            await srv.db.payment_transactions.update_one({"session_id": sid},
                {"$set": {"status": "failed", "payment_status": "failed", "updated_at": _now()}})
        if user_id:
            await _mark_failed(user_id)
    elif et == "checkout.session.expired":
        if sid:
            await srv.db.payment_transactions.update_one({"session_id": sid},
                {"$set": {"status": "expired", "payment_status": "expired", "updated_at": _now()}})
    elif et == "customer.subscription.deleted":
        if user_id:
            await _cancel_at_period_end(user_id)
    return {"ok": True}
