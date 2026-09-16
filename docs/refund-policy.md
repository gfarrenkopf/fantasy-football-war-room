# Refund policy

> **Draft.** Proposed terms, not yet published. Confirm or change the items marked **[decide]**, then publish the final version alongside the Terms of Service (Epic 7).

## What you're buying

A **season pass** is a one-time payment for **one league, for one season**. It unlocks the AI game plan for that league: the first plan plus the free rewrites. It isn't a subscription and never renews. The board, mock drafts, live odds, availability report and syncing across devices are free and don't need a pass.

## Refunds

- **Before your first AI plan is written:** full refund on request within **[decide: 14] days** of purchase.
- **After a plan is written:** the AI cost has been spent, so passes aren't refundable, except as below.
- **When the product fails you:** if a plan couldn't be written for your league (repeated failures, or the service was down during your draft), we'll refund in full whatever you've used.
- **Charged twice, or charged by mistake:** always refunded in full.
- **After the season:** passes are for the season they were bought for and aren't refunded or carried over once it ends.

To ask for a refund, email **[decide: support address]** from the account email you bought with, and name the league. Refunds go back to the original payment method, usually within 5–10 business days.

## Operator notes (not part of the published policy)

- Refund in the Stripe dashboard (Payments → the payment → Refund).
- If the pass shouldn't stay unlocked, remove it (see [payments.md §4](payments.md#4-webhook)):

  ```sql
  DELETE FROM entitlements WHERE league_id = '<league id>' AND kind = 'season_pass';
  ```

- To check whether a plan was written: `SELECT count(*) FROM ai_generations WHERE league_id = '<league id>' AND outcome = 'ready';`
