# ECOSYSTEM.md — ToshMarketplace

## Identity

ToshMarketplace is the shared web and service platform for discovering, publishing, reviewing, and distributing compatible Tosh products and host components. It is not a host app and it never executes widget code.

## Ecosystem Position

```text
ToshSDK ───────────────┐
                       ├── ToshMarketplace contracts/service
Tosh host projects ────┘              │
                                      ├── public web catalog
                                      ├── publisher portal
                                      ├── review/moderation
                                      └── artifact distribution
                                                │
                                                ▼
                                     host-specific installation clients
```

## Owns

- Product, publisher, host component, widget, release, and artifact metadata.
- Public catalog and product discovery.
- Publisher authentication boundary and submission workflow.
- Package validation, signing records, review, moderation, quarantine, and audit history.
- Immutable artifact storage boundary and versioned marketplace API.
- Marketplace client contracts used by host apps.

## Does Not Own

- Host windows or native app layout.
- Runtime execution of marketplace packages.
- Host-specific permission prompts or process isolation.
- Private app source code.
- Runtime user data or host credentials.

## Open Contribution Rule

Every Tosh app may add marketplace-specific capability:

- Publish a product and host component for the app.
- Add host compatibility metadata.
- Propose a catalog, submission, installation, or release API.
- Add app-specific permissions or trust metadata when the host can enforce them.
- Add web product-detail fields required by a real product.

An app may first implement a private product flow, then propose a reusable marketplace contract here. Marketplace openness does not mean accepting unsafe packages: every addition still needs ownership, compatibility, privacy, security, moderation, and migration evidence.

## Current State

Repository initialized for the future web marketplace and service. The first marketplace service reference implementation is currently in `../NotchinTosh/marketplace/` and will be evaluated for transfer or reuse here. No web UI or production service has been transferred yet.

## Related Documents

- `../ECOSYSTEM.md`
- `../DOCKS.md`
- `../STYLES.md`
- `DOCKS.md`
- `AGENTS.md`
- `CYCLES.md`