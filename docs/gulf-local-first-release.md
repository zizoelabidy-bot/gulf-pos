# GULF POS — local-first release gates

The draft release blocks legacy cloud registration, HTTP requests, WebSocket relay, legacy telemetry, PostHog configuration and online support submissions. New setup persists disabled cloud sync and analytics. Existing local records, licensing, and backups are retained. Existing cloud account settings and queued records are not erased. Do not imply prior remote data has been deleted.

## Acceptance before release

- Build and test on clean Windows and upgrade from 1.6.1; capture actual Arabic/English screens.
- Reconcile legacy cloud/telemetry integration tests with the new intentional contract; do not merely remove failing tests. Execute npm run test:gulf-legacy-service-policy and verify the full test suite.
- Test local owner sign-in, Master PIN recovery and backup/restore. Notify existing stores that cloud email recovery, remote reporting, companion apps and remote ticket delivery are unavailable. Provide an approved recovery path before migration.
- Capture outbound traffic during setup, boot, restore, idle, sales, support and updates; audit other network clients and endpoints. Explicitly distinguish local LAN, merchant-authorized integrations and GULF update feeds from legacy services.
- Review existing signed local GULF licensing and key custody; test trial, activation, expiration, transfer and recovery. Never ship private keys.
- Publish GULF-approved privacy policy and customer terms before replacing the existing setup links. Do not label upstream policies as GULF policies.
- Implement and verify GULF-owned support and service infrastructure before enabling network features; no guessed endpoints or simulated production success.
- Integrate PR #10, rerun financial and UI tests, sign and verify the Windows installer. Retain MIT notices in the distribution.

This document is a release checklist, not proof of runtime tests or a customer-facing legal policy.
