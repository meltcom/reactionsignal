# Donation point resets — release preparation

Recipient: meltcom@gmail.com. Existing hosted Donate button: H83DMS4NXCZLG.

Trusted members see a warning at 450 of 500 points in their current allowance, and again when reaching 500. Normal reset remains midnight UTC. Each verified positive USD donation initiated in the signed-in warning flow unlocks one reset. There is no daily maximum number of donations/resets. Reset refreshes the allowance to 500; it does not add points or remove any ledger entries. Reset is available at 450 or above; an unused donation credit remains available later. Other members' existing per-action limits remain unchanged.

The hosted PayPal Donate flow is verified by IPN, not a browser callback or REST-app webhook. The listener posts the exact body back to PayPal's fixed HTTPS verification endpoint and requires VERIFIED, Completed, the expected receiving email, positive USD gross amount, and a server-issued opaque member reference. Transaction IDs are deduplicated globally. D1 transactional batches consume credits once and update only that member's UTC-day offset. Refund/reversal notifications revoke unused credits and prevent delayed Completed replays. Previously earned points remain intact, including when a previously used donation is refunded; no automatic point clawback is introduced.

The existing state table stores intents, receipts and per-member/day offsets. No schema migration is needed. No donor names, bank details or card details are stored. Receipt transaction identifiers and member references stay server-side. Generic donations made outside the signed-in flow cannot be assigned automatically to an account.

## Required activation checks

- Feature defaults off. Enable DONATION_RESETS_ENABLED=1 only after payment-provider testing and review. While off, the warning explains donations do not unlock resets yet and retains the existing support link.
- Confirm this personal account can receive IPN notifications for the existing hosted button, including that checkout preserves custom and notify_url. The return URL alone must never unlock anything.
- Configure PayPal IPN listener URL as https://reactionjourney.com/api/donations/ipn in PayPal settings if required. Do not replace another existing listener without reviewing its users. Per-checkout notify_url is supplied; actual PayPal delivery must be verified.
- Test a separate sandbox integration before production activation. Set PAYPAL_MODE=sandbox, PAYPAL_SANDBOX_RECEIVER_EMAIL and PAYPAL_SANDBOX_BUTTON_ID only on the isolated staging worker/database. Sandbox mode uses PayPal's sandbox checkout and verification endpoint, requires test_ipn=1, and refuses production hostnames. Live mode rejects test_ipn=1 and uses only the live endpoint. Never claim simulated application tests prove actual provider delivery.
- Confirm PayPal permits a reset benefit for this account's chosen donation product before collecting payments for it. If the hosted Donate product is unsuitable, retain the generic support link and use an approved payment product for resets.
- Verify real provider confirmation, recipient, member matching, duplicated notifications, pending/cancelled payments, refund/reversal, two-tab reset races, midnight UTC and full signed-in feed on staging. Unit simulations establish application behavior, not PayPal-account eligibility or delivery.
- Review the preview before release. Use current source and the guarded staging/production process, recording active production rollback version. No production deploy or PayPal account changes are part of this preparation.

References: https://developer.paypal.com/sdk/donate/ and https://developer.paypal.com/api/nvp-soap/ipn/ht-ipn/.
