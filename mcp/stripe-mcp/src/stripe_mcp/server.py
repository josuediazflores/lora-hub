"""Stripe MCP server.

Four tools wrapping the Stripe Python SDK. All amounts are integer minor
units (e.g. cents for USD). Errors are returned as a structured
``{"error": {...}}`` object rather than raised, so the caller doesn't have
to special-case ``isError`` envelopes.
"""

import hashlib
import json
import os
import re
import secrets
import time
import urllib.parse
from datetime import datetime, timezone
from typing import Any

import stripe
from dateutil.relativedelta import relativedelta
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("stripe-mcp")


def _err(e: Exception) -> dict[str, Any]:
    return {"error": {"type": e.__class__.__name__, "message": str(e)}}


def _guard_mutation() -> dict | None:
    """Block money-moving tools unless running against a test key (or the
    operator explicitly opted into live mode). Returns a structured error to
    return to the caller, or None when the operation is allowed.

    This is defense-in-depth on top of the desktop app's per-call confirmation
    prompt: even if a tool call slips through, it can't move real money against
    an ``sk_live_`` key by default.
    """
    key = os.environ.get("STRIPE_SECRET_KEY", "")
    if key.startswith("sk_test_") or os.environ.get("STRIPE_ALLOW_LIVE") == "1":
        return None
    return {
        "error": {
            "type": "live_key_blocked",
            "message": (
                "Refusing to run a money-moving Stripe tool with a non-test "
                "key. Use an sk_test_… key, or set STRIPE_ALLOW_LIVE=1 to allow "
                "live-mode operations."
            ),
        }
    }


def _idem(provided: str | None, *parts: Any) -> str:
    """A stable Stripe idempotency key. If the caller supplies one, use it;
    otherwise derive it from the semantic arguments so an accidental retry
    (e.g. after the desktop app's 60s MCP timeout) doesn't double-charge or
    double-refund."""
    if provided:
        return provided
    raw = json.dumps(parts, sort_keys=True, default=str)
    return "lh-" + hashlib.sha256(raw.encode()).hexdigest()[:48]


def _allocate_cents(weights: list[float], total_cents: int) -> list[int]:
    """Split ``total_cents`` across recipients by weight using the
    largest-remainder method, so the integer parts sum EXACTLY to total_cents
    (no money lost/created to independent float rounding). With zero/negative
    total weight, falls back to an even split.
    """
    k = len(weights)
    if k == 0 or total_cents <= 0:
        return [0] * k
    wsum = sum(weights)
    if wsum <= 0:
        weights = [1.0] * k
        wsum = float(k)
    raw = [total_cents * w / wsum for w in weights]
    floors = [int(x) for x in raw]  # non-negative → floor
    remainder = total_cents - sum(floors)
    order = sorted(range(k), key=lambda i: raw[i] - floors[i], reverse=True)
    for j in range(remainder):
        floors[order[j % k]] += 1
    return floors


@mcp.tool()
def create_payment_link(
    amount: int, currency: str, description: str, idempotency_key: str | None = None
) -> dict:
    """Create a one-off Stripe Payment Link for a single product.

    amount: integer minor units (e.g. 2000 = $20.00 for USD).
    currency: ISO 4217 lowercase (e.g. 'usd').
    description: product name shown on the checkout page.
    Returns {url, id, amount, currency} on success, {error: {...}} on failure.
    """
    if (blocked := _guard_mutation()) is not None:
        return blocked
    try:
        amount = int(amount)
        currency = str(currency).lower()
        product = stripe.Product.create(name=description)
        price = stripe.Price.create(
            product=product.id,
            unit_amount=amount,
            currency=currency,
        )
        link = stripe.PaymentLink.create(
            line_items=[{"price": price.id, "quantity": 1}],
            idempotency_key=_idem(
                idempotency_key, "payment_link", amount, currency, description
            ),
        )
        return {
            "url": link.url,
            "id": link.id,
            "amount": int(amount),
            "currency": currency.lower(),
        }
    except stripe.error.StripeError as e:
        return _err(e)


@mcp.tool()
def create_invoice(
    customer_email: str,
    line_items: list[dict],
    due_date: str,
    idempotency_key: str | None = None,
) -> dict:
    """Create, finalize, and email a Stripe invoice.

    customer_email: looked up by email; created if not found.
    line_items: list of {description, amount, quantity?, currency?}. amount is
        integer minor units. currency defaults to 'usd' per item if omitted.
    due_date: YYYY-MM-DD (UTC midnight).
    Returns {id, hosted_invoice_url, amount_due, status} or {error: {...}}.
    """
    if (blocked := _guard_mutation()) is not None:
        return blocked
    try:
        existing = stripe.Customer.list(email=customer_email, limit=1).data
        customer = existing[0] if existing else stripe.Customer.create(email=customer_email)

        for item in line_items:
            # Stripe rejects amount+quantity together — you pick one shape:
            # either {amount: total} OR {unit_amount: each, quantity: n}.
            qty = int(item.get("quantity", 1))
            params: dict[str, Any] = {
                "customer": customer.id,
                "currency": str(item.get("currency", "usd")).lower(),
                "description": str(item.get("description", "")),
            }
            if qty > 1:
                params["unit_amount"] = int(item["amount"])
                params["quantity"] = qty
            else:
                params["amount"] = int(item["amount"])
            stripe.InvoiceItem.create(**params)

        due_ts = int(
            datetime.strptime(due_date, "%Y-%m-%d")
            .replace(tzinfo=timezone.utc)
            .timestamp()
        )
        inv = stripe.Invoice.create(
            customer=customer.id,
            collection_method="send_invoice",
            due_date=due_ts,
            idempotency_key=_idem(
                idempotency_key, "invoice", customer.id, line_items, due_date
            ),
        )
        inv = stripe.Invoice.finalize_invoice(inv.id)
        # send_invoice often fails in sandbox accounts that haven't completed
        # the business profile (Stripe blocks outbound email). Treat the send
        # as best-effort: surface the hosted URL either way so the caller can
        # share it manually.
        sent = False
        send_error: str | None = None
        try:
            inv = stripe.Invoice.send_invoice(inv.id)
            sent = True
        except stripe.error.StripeError as send_e:
            send_error = str(send_e)
        return {
            "id": inv.id,
            "hosted_invoice_url": inv.hosted_invoice_url,
            "amount_due": inv.amount_due,
            "status": inv.status,
            "sent": sent,
            "send_error": send_error,
        }
    except stripe.error.StripeError as e:
        return _err(e)
    except (ValueError, KeyError, TypeError) as e:
        # Bad input shape (e.g. malformed due_date, missing item amount) — keep
        # it inside the structured-error contract instead of raising.
        return _err(e)


@mcp.tool()
def list_transactions(limit: int = 10) -> dict:
    """Return the most recent N charges (1–100, default 10).

    Returns {charges: [{id, amount, currency, status, description, created}]}
    or {error: {...}}.
    """
    try:
        n = max(1, min(int(limit), 100))
        charges = stripe.Charge.list(limit=n).data
        return {
            "charges": [
                {
                    "id": c.id,
                    "amount": c.amount,
                    "currency": c.currency,
                    "status": c.status,
                    "description": c.description,
                    "created": c.created,
                }
                for c in charges
            ]
        }
    except stripe.error.StripeError as e:
        return _err(e)


@mcp.tool()
def create_subscription(
    customer_email: str,
    amount: int,
    currency: str = "usd",
    interval: str = "month",
    interval_count: int = 1,
    description: str = "Subscription",
    idempotency_key: str | None = None,
) -> dict:
    """Create a recurring Stripe subscription.

    Always creates a *fresh* customer with a brand-new test clock attached
    and pm_card_visa as the default payment method, so the subscription is
    immediately `active` and the test clock can be fast-forwarded later.

    amount: integer minor units per billing interval (e.g. 2000 = $20.00 USD).
    interval: 'day' | 'week' | 'month' | 'year'.
    interval_count: e.g. interval='month' + interval_count=3 → quarterly.

    Returns {id, customer_id, customer_email, test_clock_id, amount, currency,
    interval, interval_count, status, current_period_end, description,
    latest_invoice_url}.
    """
    if (blocked := _guard_mutation()) is not None:
        return blocked
    try:
        clock = stripe.test_helpers.TestClock.create(frozen_time=int(time.time()))
        customer = stripe.Customer.create(
            email=customer_email,
            test_clock=clock.id,
            payment_method="pm_card_visa",
            invoice_settings={"default_payment_method": "pm_card_visa"},
        )
        product = stripe.Product.create(name=description)
        price = stripe.Price.create(
            product=product.id,
            unit_amount=int(amount),
            currency=currency.lower(),
            recurring={
                "interval": interval,
                "interval_count": int(interval_count),
            },
        )
        sub = stripe.Subscription.create(
            customer=customer.id,
            items=[{"price": price.id}],
            expand=["latest_invoice", "items.data"],
            idempotency_key=_idem(
                idempotency_key, "subscription", customer.id, amount, interval
            ),
        )
        latest = getattr(sub, "latest_invoice", None)
        latest_url = (
            getattr(latest, "hosted_invoice_url", None)
            if latest is not None and not isinstance(latest, str)
            else None
        )
        return {
            "id": sub.id,
            "customer_id": customer.id,
            "customer_email": customer_email,
            "test_clock_id": clock.id,
            "amount": int(amount),
            "currency": currency.lower(),
            "interval": interval,
            "interval_count": int(interval_count),
            "status": sub.status,
            "current_period_end": _current_period_end(sub),
            "description": description,
            "latest_invoice_url": latest_url,
        }
    except stripe.error.StripeError as e:
        return _err(e)


@mcp.tool()
def list_subscriptions(limit: int = 10) -> dict:
    """List recent Stripe subscriptions (1–100, default 10).

    Returns {subscriptions: [{id, customer_id, customer_email, amount,
    currency, interval, interval_count, status, current_period_end,
    test_clock_id}]}.
    """
    try:
        n = max(1, min(int(limit), 100))
        expand = ["data.customer", "data.items.data.price"]
        # Stripe's Subscription.list() *excludes* subs whose customer has a
        # test clock attached unless you pass test_clock=<id>. Since every
        # demo subscription we create has a test clock, fan out across all
        # clocks first, then merge with the regular (non-test-clock) listing.
        seen: dict[str, Any] = {}
        for s in stripe.Subscription.list(
            limit=n, status="all", expand=expand
        ).data:
            seen[s.id] = s
        clocks = stripe.test_helpers.TestClock.list(limit=100).data
        for clock in clocks:
            for s in stripe.Subscription.list(
                limit=n,
                status="all",
                test_clock=clock.id,
                expand=expand,
            ).data:
                seen[s.id] = s
        merged = sorted(seen.values(), key=lambda s: s.created, reverse=True)[:n]
        return {"subscriptions": [_subscription_dict(s) for s in merged]}
    except stripe.error.StripeError as e:
        return _err(e)


@mcp.tool()
def cancel_subscription(subscription_id: str, immediately: bool = True) -> dict:
    """Cancel a Stripe subscription.

    immediately=True (default) cancels right now; False sets
    cancel_at_period_end so it lapses at the end of the current cycle.
    Returns {id, status, canceled_at, cancel_at_period_end}.
    """
    if (blocked := _guard_mutation()) is not None:
        return blocked
    try:
        if immediately:
            sub = stripe.Subscription.delete(subscription_id)
        else:
            sub = stripe.Subscription.modify(
                subscription_id, cancel_at_period_end=True
            )
        return {
            "id": sub.id,
            "status": sub.status,
            "canceled_at": sub.canceled_at,
            "cancel_at_period_end": sub.cancel_at_period_end,
        }
    except stripe.error.StripeError as e:
        return _err(e)


@mcp.tool()
def advance_test_clock(clock_id: str, by_months: int = 1) -> dict:
    """Fast-forward a Stripe test clock by N months (1–24).

    NON-BLOCKING: Stripe processes the advance asynchronously. This tool
    returns immediately with status='advancing'. Poll get_test_clock until
    status='ready' (typically 5–60s for 1 month, up to 2min for 12 months),
    then re-call list_subscriptions / list_transactions to see the simulated
    billing cycles.

    Returns {clock_id, frozen_time, status}.
    """
    try:
        n = max(1, min(int(by_months), 24))
        clock = stripe.test_helpers.TestClock.retrieve(clock_id)
        new_time = _add_months(int(clock.frozen_time), n)
        advanced = stripe.test_helpers.TestClock.advance(
            clock_id, frozen_time=new_time
        )
        return {
            "clock_id": clock_id,
            "frozen_time": advanced.frozen_time,
            "status": advanced.status,
        }
    except stripe.error.StripeError as e:
        return _err(e)


@mcp.tool()
def get_test_clock(clock_id: str) -> dict:
    """Read current state of a Stripe test clock.

    Returns {clock_id, frozen_time, status} where status is one of
    'ready' | 'advancing' | 'internal_failure'.
    """
    try:
        clock = stripe.test_helpers.TestClock.retrieve(clock_id)
        return {
            "clock_id": clock_id,
            "frozen_time": clock.frozen_time,
            "status": clock.status,
        }
    except stripe.error.StripeError as e:
        return _err(e)


def _subscription_dict(sub: Any) -> dict:
    """Flatten a stripe.Subscription (with customer + items.price expanded)
    into the same shape create_subscription returns."""
    customer = getattr(sub, "customer", None)
    cust_id = customer if isinstance(customer, str) else getattr(customer, "id", None)
    cust_email = (
        getattr(customer, "email", None) if not isinstance(customer, str) else None
    )
    test_clock = getattr(customer, "test_clock", None) if not isinstance(customer, str) else None
    clock_id = (
        test_clock if isinstance(test_clock, str)
        else getattr(test_clock, "id", None) if test_clock is not None else None
    )
    items = getattr(sub.items, "data", []) if hasattr(sub, "items") else []
    price = items[0].price if items else None
    amount = int(getattr(price, "unit_amount", 0) or 0)
    currency = getattr(price, "currency", "usd")
    recurring = getattr(price, "recurring", None) if price else None
    interval = getattr(recurring, "interval", "month") if recurring else "month"
    interval_count = int(
        getattr(recurring, "interval_count", 1) if recurring else 1
    )
    return {
        "id": sub.id,
        "customer_id": cust_id,
        "customer_email": cust_email,
        "amount": amount,
        "currency": currency,
        "interval": interval,
        "interval_count": interval_count,
        "status": sub.status,
        "current_period_end": _current_period_end(sub),
        "test_clock_id": clock_id,
    }


def _current_period_end(sub: Any) -> int | None:
    """Stripe's 2024-12 API moved current_period_end off Subscription onto
    each SubscriptionItem (so multi-item subs can have differing periods).
    Read the top-level field if present (older API), else the first item's."""
    top = getattr(sub, "current_period_end", None)
    if top is not None:
        return int(top)
    items = getattr(getattr(sub, "items", None), "data", None) or []
    if items:
        item_end = getattr(items[0], "current_period_end", None)
        if item_end is not None:
            return int(item_end)
    return None


def _add_months(unix_seconds: int, n: int) -> int:
    """Calendar-month-aware offset (handles month lengths + leap years)."""
    dt = datetime.fromtimestamp(unix_seconds, tz=timezone.utc)
    return int((dt + relativedelta(months=n)).timestamp())


# ---------------------------------------------------------------------------
# Bill-splitting tools
# ---------------------------------------------------------------------------

_PRICE_RE = re.compile(r"(?:\$|USD\s*)?(\d{1,4}(?:[.,]\d{2}))")


@mcp.tool()
def parse_receipt(image_path: str) -> dict:
    """OCR a receipt image and return the raw text plus heuristic line-item
    candidates. The model should refine `suggested_items` into the structured
    shape that split_bill expects.

    image_path: absolute path to a JPEG/PNG receipt image on the local disk.
    Returns {raw_text, suggested_items: [{name, price}], note?}.
    Requires Tesseract installed locally (brew install tesseract).
    """
    try:
        from PIL import Image  # type: ignore[import-not-found]
        import pytesseract  # type: ignore[import-not-found]
    except ImportError as e:
        return _err_msg("DependencyError", f"Receipt OCR deps missing: {e}")
    try:
        img = Image.open(image_path)
        text = pytesseract.image_to_string(img)
    except FileNotFoundError as e:
        return _err_msg("FileNotFound", str(e))
    except pytesseract.TesseractNotFoundError:
        return _err_msg(
            "TesseractNotInstalled",
            "Tesseract binary not found. Install it: 'brew install tesseract' "
            "(macOS) or 'apt install tesseract-ocr' (Linux).",
        )
    except Exception as e:  # noqa: BLE001 — surface anything else cleanly
        return _err_msg(e.__class__.__name__, str(e))

    suggested = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        matches = list(_PRICE_RE.finditer(line))
        if not matches:
            continue
        last = matches[-1]
        price_str = last.group(1).replace(",", ".")
        try:
            price = float(price_str)
        except ValueError:
            continue
        name = line[: last.start()].strip(" -:\t·•")
        if name and 0 < price < 10_000:
            suggested.append({"name": name, "price": price})
    return {"raw_text": text.strip(), "suggested_items": suggested}


@mcp.tool()
def split_bill(
    items: list[dict],
    people: list[str],
    assignments: dict | None = None,
    tip_strategy: str = "even",
    tax_strategy: str = "proportional",
    tip: float = 0.0,
    tax: float = 0.0,
    description: str = "Bill split",
) -> dict:
    """Compute per-person totals from itemized assignments.

    items: [{name: str, price: float}] in major units (e.g. dollars).
    people: full participant list (case-sensitive names).
    assignments: {item_index_or_name: [person_names | "*"]}. "*" = everyone.
        Items with no assignment default to "*" (split evenly).
    tip / tax: amounts in major units (already on top of the line items).
    tip_strategy: "even" (split equally) or "proportional" (by subtotal).
    tax_strategy: "proportional" (by subtotal) or "even".

    Returns {per_person: [{name, subtotal, tax, tip, total}],
             grand_total, currency_hint?}.
    """
    if not people:
        return _err_msg("InvalidInput", "'people' must be non-empty.")
    assignments = assignments or {}
    n = len(people)
    idx_of = {p: i for i, p in enumerate(people)}
    # All money math is done in integer cents with largest-remainder allocation
    # so the per-person totals sum EXACTLY to the bill — independent float
    # rounding (the previous approach) could be off by a cent or more.
    sub_cents: list[int] = [0] * n

    for idx, item in enumerate(items):
        name = item.get("name", f"item {idx + 1}")
        price_cents = int(round(float(item.get("price", 0)) * 100))
        key_options = [str(idx), name]
        assignees = None
        for k in key_options:
            if k in assignments:
                assignees = assignments[k]
                break
        if assignees is None:
            assignees = ["*"]
        if "*" in assignees or not assignees:
            assignees = list(people)
        valid = [a for a in assignees if a in people]
        if not valid:
            valid = list(people)
        # Split this item's cents evenly across its assignees, exactly.
        parts = _allocate_cents([1.0] * len(valid), price_cents)
        for person, part in zip(valid, parts):
            sub_cents[idx_of[person]] += part

    subtotal_cents = sum(sub_cents)
    tax_cents_total = int(round(float(tax) * 100))
    tip_cents_total = int(round(float(tip) * 100))

    def weights_for(strat: str) -> list[float]:
        if strat == "even" or subtotal_cents <= 0:
            return [1.0] * n
        return [float(c) for c in sub_cents]

    tax_cents = _allocate_cents(weights_for(tax_strategy), tax_cents_total)
    tip_cents = _allocate_cents(weights_for(tip_strategy), tip_cents_total)

    per_person = []
    for i, p in enumerate(people):
        total_c = sub_cents[i] + tax_cents[i] + tip_cents[i]
        per_person.append(
            {
                "name": p,
                "subtotal": round(sub_cents[i] / 100, 2),
                "tax": round(tax_cents[i] / 100, 2),
                "tip": round(tip_cents[i] / 100, 2),
                "total": round(total_c / 100, 2),
            }
        )
    grand_total_cents = subtotal_cents + tax_cents_total + tip_cents_total
    return {
        "per_person": per_person,
        "grand_total": round(grand_total_cents / 100, 2),
        "items": items,
        "tip": round(tip_cents_total / 100, 2),
        "tax": round(tax_cents_total / 100, 2),
        "description": description,
    }


@mcp.tool()
def create_split_payment_links(
    per_person: list[dict],
    description: str,
    currency: str = "usd",
    split_id: str | None = None,
    idempotency_key: str | None = None,
) -> dict:
    """Create one Stripe Payment Link per payer, tagged with metadata so
    split_status can attribute payments back later.

    per_person: [{name: str, total: float}] from split_bill (major units).
    description: shown on the checkout page (e.g. 'Dinner at Mama's').
    split_id: optional caller-supplied id; auto-generated if omitted.

    Returns {split_id, currency, links: [{name, url, id, amount}]}.
    """
    if (blocked := _guard_mutation()) is not None:
        return blocked
    try:
        sid = split_id or secrets.token_urlsafe(8)
        links = []
        for entry in per_person:
            name = str(entry.get("name", ""))
            total_major = float(entry.get("total", 0))
            amount_minor = int(round(total_major * 100))
            if amount_minor <= 0:
                continue
            link = stripe.PaymentLink.create(
                line_items=[
                    {
                        "price_data": {
                            "currency": currency.lower(),
                            "product_data": {"name": f"{description} — {name}"},
                            "unit_amount": amount_minor,
                        },
                        "quantity": 1,
                    }
                ],
                metadata={"split_id": sid, "payer_name": name},
                idempotency_key=_idem(
                    idempotency_key, "split_link", sid, name, amount_minor
                ),
            )
            links.append(
                {
                    "name": name,
                    "url": link.url,
                    "id": link.id,
                    "amount": amount_minor,
                }
            )
        return {"split_id": sid, "currency": currency.lower(), "links": links}
    except stripe.error.StripeError as e:
        return _err(e)


@mcp.tool()
def send_payment_requests(
    channel: str,
    requests: list[dict],
    description: str = "Bill split",
) -> dict:
    """Build prefilled SMS/email/clipboard message URIs for each payer. The
    frontend (or the user) opens these — this tool does NOT send anything
    over the network itself; it just produces the links.

    channel: 'sms' | 'email' | 'clipboard'.
    requests: [{name, contact?, url, amount}]. `contact` is the phone (sms)
        or email (email). Omit for clipboard.
    Returns {channel, messages: [{name, contact?, uri, body}]}.
    """
    if channel not in ("sms", "email", "clipboard"):
        return _err_msg("InvalidInput", f"unknown channel: {channel}")
    out = []
    for r in requests:
        name = str(r.get("name", ""))
        url = str(r.get("url", ""))
        amount_minor = int(r.get("amount", 0))
        amount_str = f"${amount_minor / 100:.2f}"
        contact = r.get("contact")
        body = (
            f"Hey {name}! {description} came out to {amount_str}. "
            f"Pay here: {url}"
        )
        if channel == "sms":
            uri = f"sms:{contact or ''}?&body={urllib.parse.quote(body)}"
        elif channel == "email":
            params = urllib.parse.urlencode(
                {"subject": f"{description} — your share", "body": body}
            )
            uri = f"mailto:{contact or ''}?{params}"
        else:  # clipboard
            uri = ""
        out.append(
            {"name": name, "contact": contact, "uri": uri, "body": body}
        )
    return {"channel": channel, "messages": out}


@mcp.tool()
def split_status(split_id: str, limit: int = 50) -> dict:
    """Poll Stripe for charges tagged with this split_id and report who has
    paid. Reads charge.metadata.split_id and matches against the supplied id.

    Returns {split_id, paid: [{name, amount, paid_at, charge_id}],
             pending_count}. (Pending payers are inferred from the original
             create_split_payment_links output, which the model still has.)
    """
    try:
        n = max(1, min(int(limit), 100))
        # Stripe's Charge.list doesn't filter by metadata server-side; pull
        # the recent N and filter client-side. Fine for demo scale.
        charges = stripe.Charge.list(limit=n).data
        paid = []
        for c in charges:
            md = getattr(c, "metadata", {}) or {}
            if md.get("split_id") == split_id and c.status == "succeeded":
                paid.append(
                    {
                        "name": md.get("payer_name", "—"),
                        "amount": c.amount,
                        "paid_at": c.created,
                        "charge_id": c.id,
                    }
                )
        return {"split_id": split_id, "paid": paid}
    except stripe.error.StripeError as e:
        return _err(e)


def _err_msg(err_type: str, message: str) -> dict:
    return {"error": {"type": err_type, "message": message}}


@mcp.tool()
def refund_payment(
    charge_id: str, amount: int | None = None, idempotency_key: str | None = None
) -> dict:
    """Refund a charge in full (amount omitted) or partially (integer minor units).

    Returns {id, amount, status} or {error: {...}}.
    """
    if (blocked := _guard_mutation()) is not None:
        return blocked
    try:
        kwargs: dict[str, Any] = {"charge": charge_id}
        if amount is not None:
            kwargs["amount"] = int(amount)
        # Stable idempotency key so a retried refund (e.g. after the desktop
        # app's 60s MCP timeout) doesn't refund twice.
        refund = stripe.Refund.create(
            idempotency_key=_idem(idempotency_key, "refund", charge_id, amount),
            **kwargs,
        )
        return {"id": refund.id, "amount": refund.amount, "status": refund.status}
    except stripe.error.StripeError as e:
        return _err(e)
    except (ValueError, TypeError) as e:
        return _err(e)
