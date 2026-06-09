# stripe-mcp

A local [MCP](https://modelcontextprotocol.io/) server that exposes a small,
opinionated slice of the [Stripe](https://stripe.com) API as tools an
on-device LLM can call. Designed as a pluggable MCP server for
[lora-hub](https://github.com/josuediazflores/lora-hub), alongside the
existing `fli-mcp` (Google Flights) integration.

> **Warning:** every tool here mutates real Stripe state (creates products,
> sends invoices, issues refunds). **Always** use a `sk_test_…` key during
> development. A live key plus an over-eager LLM is a great way to charge or
> refund real money.

## Tools

| Tool                  | What it does                                                        |
| --------------------- | ------------------------------------------------------------------- |
| `create_payment_link` | Creates a one-product Stripe Payment Link and returns its URL.      |
| `create_invoice`      | Creates, finalizes, and emails a Stripe invoice to a customer.      |
| `list_transactions`   | Returns the last N charges (id, amount, currency, status, …).       |
| `refund_payment`      | Issues a full or partial refund against a charge id.                |

All amounts are **integer minor units** (e.g. `2000` = $20.00 for USD). The
tool docstrings reinforce this so the model passes the right scale.

## Install

From the lora-hub repo root:

```bash
pipx install ./mcp/stripe-mcp
```

(Or `pipx install stripe-mcp` once published to PyPI.)

`pipx` puts the entry point at `~/.local/bin/stripe-mcp`, which is where
lora-hub's MCP resolver looks first.

## Standalone smoke test

```bash
export STRIPE_SECRET_KEY=sk_test_...

# initialize → list tools → call list_transactions(limit=3)
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_transactions","arguments":{"limit":3}}}' \
  | stripe-mcp
```

You should see four JSON-RPC responses on stdout: an initialize ack, the
four-tool catalog, and the most recent test-mode charges. If `STRIPE_SECRET_KEY`
is missing, the server exits 1 with a helpful stderr message instead of
hanging.

## Wire into lora-hub with a local Gemma

1. Install the server (see above).
2. Export your Stripe test key in the shell that launches lora-hub:
   ```bash
   export STRIPE_SECRET_KEY=sk_test_...
   ./scripts/dev.sh
   ```
   The Tauri app inherits the env var and propagates it to the spawned
   `stripe-mcp` subprocess.
3. In **Settings → Integrations**, toggle **stripe tools in normal chat** on.
   It's off by default because these tools spend real money.
4. In a chat with your local Gemma loaded, try:
   - *"create a $20 payment link for a coffee subscription"* → returns a
     hosted Stripe Checkout URL.
   - *"show my last 5 charges"* → returns the recent transaction list.
   - *"refund charge ch_… in full"* → issues a refund.

Every tool call is recorded in the lora-hub audit log
(`Settings → Audit log`), same as `fli-mcp` calls.

## Subscriptions + time travel

Beyond the four one-shot tools, stripe-mcp also exposes recurring billing
backed by Stripe **Test Clocks**, so you can spin up a subscription and
fast-forward a year of billing in 30 seconds.

| Tool                  | What it does                                                                  |
| --------------------- | ----------------------------------------------------------------------------- |
| `create_subscription` | Creates a fresh customer + test clock + recurring price + active subscription. |
| `list_subscriptions`  | Returns recent subs across all statuses, including test-clock subs.            |
| `cancel_subscription` | Cancels immediately, or at period end with `immediately=false`.                |
| `advance_test_clock`  | Fast-forwards a clock by N months (1–24). Non-blocking.                        |
| `get_test_clock`      | Polls a clock's current status (`ready` / `advancing` / `internal_failure`).   |

### Demo prompt

In a chat with **stripe tools in normal chat** ON:

> *"subscribe alice@example.com to $20/month coffee"*

You get a `SubscriptionCard` with status `active`, a next-invoice date one
month out, and three buttons: **⏩ 1 month / 3 months / 1 year**. Click
"1 year" → buttons disable, an "Advancing 12mo… 14s" indicator appears, and
60–90s later the card refreshes with `current_period_end` 12 months ahead.
Then ask *"show my last 15 charges"* and you'll see 12 monthly $20 charges
that didn't exist before.

### Caveats

- **`pm_card_visa`** is hardcoded as the default payment method on every
  customer. This makes subscriptions immediately `active` (no `incomplete`
  state) but means every charge succeeds. To demo dunning / `past_due`,
  swap the token in `server.py` to `pm_card_chargeDeclined`.
- **Test clocks expire after 30 real days**, after which Stripe deletes the
  clock + customer + their subscriptions automatically. Subs created for a
  one-shot demo are fine; long-running ones aren't.
- **Stripe excludes test-clock subscriptions from default `Subscription.list`.**
  `list_subscriptions` works around this by fanning out across all test
  clocks first, then merging with the regular listing.
- **Concurrent advances on one clock are rejected** by Stripe. The
  SubscriptionCard's busy state prevents double-clicks; a model that fires
  two advances back-to-back will get a structured error on the second.

## Bill splitting

Five tools layered on top of `create_payment_link` turn this into an
on-device bill-splitter. The model orchestrates the flow: parse a receipt
photo → confirm assignments with the user → compute per-person totals →
generate one Stripe Payment Link per payer → draft outreach messages →
poll for paid status.

| Tool                          | What it does                                                              |
| ----------------------------- | ------------------------------------------------------------------------- |
| `parse_receipt`               | OCR a receipt image (Tesseract). Returns raw text + heuristic line items. |
| `split_bill`                  | Pure compute: turns items + assignments into per-person totals.           |
| `create_split_payment_links`  | One Stripe Payment Link per payer, tagged with `metadata.split_id`.       |
| `send_payment_requests`       | Builds prefilled `sms:` / `mailto:` URIs the frontend can render.         |
| `split_status`                | Polls Stripe charges for the split_id and reports who has paid.           |

### System dependency

`parse_receipt` shells out to Tesseract:

```bash
brew install tesseract       # macOS
sudo apt install tesseract-ocr  # Debian/Ubuntu
```

Without Tesseract installed, `parse_receipt` returns a structured
`{error: {type: "TesseractNotInstalled", ...}}` envelope (no crash).

### Demo prompt

In a chat with **stripe tools in normal chat** ON, attach a receipt photo
and ask:

> *"split this dinner — Bob had the burger, Alice and I shared the
> calamari, everyone split the wine, plus 20% tip"*

Expected card sequence:
1. `parse_receipt` → raw OCR text bubble.
2. Model proposes structured items in prose, then calls `split_bill`.
3. `SplitBillCard` renders per-person totals.
4. After confirmation: `create_split_payment_links` → `SplitStatusCard`
   renders with one row per payer (status `pending`, action buttons).
5. Click the **SMS** / **Email** button on a row to fire your default
   compose with the link prefilled. Or **Open** to test-pay it yourself.
6. Hit **refresh** in the card footer (or ask the model "any updates?")
   to re-run `split_status` and flip paid rows to ✅.
