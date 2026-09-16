# Payments

The hosted app sells a one-time **season pass** per league through Stripe. It unlocks the AI-written draft plan for that league. The board, mock drafts, availability report and cross-device sync are always free.

**Self-hosting doesn't need any of this.** With the Stripe variables unset, payments are off, nothing is paywalled, and the checkout and webhook routes answer 404. You pay your own AI provider directly with your own key.

## Contents

1. [How it's switched on](#1-how-its-switched-on)
2. [Stripe product setup](#2-stripe-product-setup)
3. [Local testing](#3-local-testing)

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

## 3. Local testing

1. Run cloud features locally (see [database.md](database.md)) and set `STRIPE_SECRET_KEY` to a test key and `STRIPE_PRICE_ID` to the test price.
2. Install the [Stripe CLI](https://docs.stripe.com/stripe-cli), then run `stripe login`.
3. Forward events to the app and copy the `whsec_…` it prints into `STRIPE_WEBHOOK_SECRET`:

   ```sh
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```

4. Restart `npm run dev` so the new variables are read.

Pay with test card `4242 4242 4242 4242`, any future expiry date and any CVC.
