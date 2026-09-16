# Payments

The hosted app sells a one-time **season pass** per league through Stripe. It unlocks the AI-written draft plan for that league. The board, mock drafts, availability report and cross-device sync are always free.

**Self-hosting doesn't need any of this.** With the Stripe variables unset, payments are off, nothing is paywalled, and the checkout and webhook routes answer 404. You pay your own AI provider directly with your own key.

## Contents

1. [How it's switched on](#1-how-its-switched-on)
2. [Stripe product setup](#2-stripe-product-setup)
3. [Checkout](#3-checkout)
4. [Webhook](#4-webhook)
5. [What the season pass unlocks](#5-what-the-season-pass-unlocks)
6. [Purchase history and refunds](#6-purchase-history-and-refunds)
7. [Local testing](#7-local-testing)

---

## 1. How it's switched on

Payments turn on only when cloud features are on **and** all three variables are set:

| Variable | Where to find it |
|---|---|
| `STRIPE_SECRET_KEY` | Dashboard → Developers → API keys. `sk_test_…` in test mode, `sk_live_…` in production. |
| `STRIPE_WEBHOOK_SECRET` | The webhook endpoint's signing secret (`whsec_…`). Locally, `stripe listen` prints one. |
| `STRIPE_PRICE_ID` | The season pass price (`price_…`), from step 2. |

If only some are set, payments stay off and the server logs a `[config]` warning naming what's missing. They're never half on, where checkout could take money but the webhook couldn't record the purchase.

## 2. Stripe product setup

Do this once in test mode, then again in live mode (test and live objects are separate).

1. In the [Stripe dashboard](https://dashboard.stripe.com), go to **Product catalog → Add product**.
2. Name it **Season pass**. Add a description, e.g. "AI draft plan for one league, for one season."
3. Under pricing, choose **One-off** (not recurring) and set the price.
4. Save the product, open the price, and copy its id (`price_…`) into `STRIPE_PRICE_ID`.

The price lives only in Stripe. To change it, create a new price and update `STRIPE_PRICE_ID`. No code change is needed.

## 3. Checkout

`POST /api/leagues/:id/checkout` (signed in) creates a Stripe Checkout session for the league's season pass and returns `{ url }`. The browser goes there, and Stripe sends the user back to `/?checkout=success` or `/?checkout=cancel`.

- The league must already be on the server. The client syncs league edits before asking.
- The session's `metadata` carries `leagueId`, `userId` and `kind`, which the webhook uses to record the purchase. Coming back to `?checkout=success` doesn't grant anything by itself.
- Responses: **404** when payments are off or the league isn't the user's, **409** when the league already has a pass, and **503** when Stripe can't be reached (logged as `[server-error]`, so alerts fire).
- Success and cancel links use `NEXTAUTH_URL`, because behind the proxy the request URL is the internal address.

## 4. Webhook

`POST /api/stripe/webhook` is where Stripe reports payments. It's the **only** thing that grants a season pass. Returning to the success page doesn't.

- **Authentication is the signature.** The route isn't behind a session. It checks the raw body against the `Stripe-Signature` header using `STRIPE_WEBHOOK_SECRET`. A missing, forged or tampered signature gets **400**, and nothing is read from or written to the database.
- **What grants a pass:** `checkout.session.completed` with `payment_status: "paid"` (cards), or `checkout.session.async_payment_succeeded` (payment methods that settle later). The session's metadata must name a league owned by the user who paid. The row goes into `entitlements` with the session id as `source`, plus `amount_total` and `currency`.
- **Retries are safe.** There's one row per league and kind, so a repeated event answers `exists` and changes nothing.
- **Responses:** **200** for every event that's been dealt with, including ignored event types, unpaid sessions, and sessions without our metadata or with an unknown league (those last two also log a `[payments]` warning). **500** only when handling fails (e.g. the database is down). It's logged as `[server-error]`, and Stripe retries with backoff for up to three days.
- **404** when payments are off.

In the dashboard's webhook endpoint, subscribe to `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Other events are harmless but unused.

**Refunds are manual.** Refund in the Stripe dashboard, then remove the pass if it shouldn't stay unlocked:

```sql
DELETE FROM entitlements WHERE league_id = '<league id>' AND kind = 'season_pass';
```

## 5. What the season pass unlocks

Only the AI game plan: the first plan plus the free rewrites (`FREE_REGENERATIONS`). It's enforced on the server in `planAccess()` (`src/lib/server/ai`):

| | Payments off (self-hosted) | Payments on (hosted) |
|---|---|---|
| League with a season pass | n/a | AI plans |
| League without one | AI plans, unless `AI_ALLOWLIST` is set and the account isn't on it | Paywall: `GET /plan` returns `needsPurchase: true` and `POST /plan` gets `402` |
| Account on `AI_ALLOWLIST` | AI plans | AI plans, no pass needed (for the operator's own testing) |

The board, mock drafts, live odds, availability report and cross-device sync are never gated.

The paywall shows in the AI game plan tab with the live turn plan underneath. After checkout the tab checks every 2 seconds, for up to 30 seconds, until the webhook has recorded the pass, then unlocks. If the webhook is slower than that, reloading picks it up.

## 6. Purchase history and refunds

Signed-in users see **Purchases** next to Sign out when payments are on. It lists each season pass with its league, date and amount, and still shows leagues deleted since. It's served by `GET /api/purchases` (404 when payments are off).

Refunds follow [refund-policy.md](refund-policy.md). They're done by hand in the Stripe dashboard, plus removing the entitlement if the pass shouldn't stay unlocked (§4).

## 7. Local testing

1. Run cloud features locally (see [database.md](database.md)) and set `STRIPE_SECRET_KEY` to a test key and `STRIPE_PRICE_ID` to the test price.
2. Install the [Stripe CLI](https://docs.stripe.com/stripe-cli), then run `stripe login`.
3. Forward events to the app and copy the `whsec_…` it prints into `STRIPE_WEBHOOK_SECRET`:

   ```sh
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```

4. Restart `npm run dev` so the new variables are read.

Pay with test card `4242 4242 4242 4242`, any future expiry date and any CVC. The `stripe listen` window shows the event, and the webhook's response should be `200` with `"outcome":"granted"`.

To check that forged events are rejected, post an unsigned one. It should get `400`:

```sh
curl -i -X POST localhost:3000/api/stripe/webhook -H 'stripe-signature: t=1,v1=forged' -d '{}'
```
