# ToshMarketplace — Shared Web Marketplace

ToshMarketplace is the shared public web and service platform for Tosh products. It provides discovery and publishing contracts while host apps retain control over execution, permissions, installation, and native UI.

## What We Build

- Public web catalog and product pages.
- Host-filtered product and component discovery.
- Publisher accounts, Developer Mode eligibility, and namespace ownership.
- Signed package submission and automated validation.
- Two-reviewer quality/originality review with human escalation.
- Product, host component, widget, release, and artifact records.
- Immutable content-addressed artifact distribution.
- Quarantine, revocation, takedown, appeals, rollback, and audit records.
- Versioned API and SDK client contracts for host apps.
- Privacy boundary between public metadata, publisher data, and runtime data.

## Architecture

```text
ToshMarketplace
├── web catalog
├── publisher portal
├── API
│   ├── public catalog routes
│   ├── authenticated publisher routes
│   └── host installation handoff routes
├── metadata/state service
├── immutable artifact service
└── review/moderation operations
        │
        ▼
Tosh host client
  ├── verifies package again
  ├── asks for host permissions
  ├── installs atomically
  └── runs component inside host boundary
```

The marketplace web service never executes package code. A marketplace approval is not a substitute for host verification or user permission consent.

## States

| Area | Required states and behavior |
|---|---|
| Catalog | Loading, populated, empty, offline, incompatible, unavailable, quarantined |
| Publisher | Signed out, ineligible, Developer Mode enabled, terms missing, active, restricted, suspended, removed |
| Submission | Draft, validating, rejected, under review, needs human review, approved, published, quarantined |
| Release | Draft, published, superseded, revoked, archived |
| Artifact | Missing, digest mismatch, signature failure, immutable, unavailable |
| Host handoff | Not installed, verifying, permission required, installing, installed, update failed, rolled back |

## Security and Privacy

- Actor identity comes from the account boundary, never request JSON.
- Product and release mutations verify publisher ownership.
- Signing keys and credentials are never logged or exposed in public metadata.
- Runtime user data never enters catalog or publisher metadata.
- Artifacts are content-addressed and immutable.
- Quarantine disables installation while preserving auditable history.
- Host compatibility is checked before enabling installation.
- Public pages must not expose private drafts, package filesystem paths, or review secrets.

## Open Extension Policy

The marketplace is intentionally open to product-specific additions. A host may request a new host component type, permission explanation, catalog field, API route, installation handoff, or trust state when its product needs it. The requesting app must provide a real use case, compatibility behavior, privacy/security analysis, and tests. Product-specific capability is valid when declared clearly; it does not need to be forced into a lowest-common-denominator marketplace.

## Files

- `package.json` — future web/service package boundary.
- `apps/web/` — future public web and publisher surfaces.
- `src/` — future API, domain, review, and integration modules.
- `migrations/` — metadata/state schema migrations.
- `tests/` — API, privacy, compatibility, publishing, and moderation contracts.

## Dependencies

- Root `../STYLES.md` for web visual language.
- Root `../ECOSYSTEM.md` and `../DOCKS.md` for shared ownership.
- `ToshSDK` for package and host compatibility contracts.
- Each host app for installation, permissions, runtime, and rollback behavior.

## Verification

| Scenario | Expected result | Evidence |
|---|---|---|
| Public discovery | Only public, valid products appear | Pending implementation |
| Host filtering | Incompatible components cannot be installed | Pending implementation |
| Submission | Invalid package, source, digest, or signature is rejected | Pending implementation |
| Review disagreement | Release enters human escalation without mutating prior releases | Pending implementation |
| Quarantine | Installation is disabled and history remains auditable | Pending implementation |
| Privacy | Runtime data and credentials never enter public metadata | Pending implementation |
| Host failure | Marketplace remains available when a host component crashes | Pending host integration |
| Product-specific contribution | A host can add a marketplace capability with compatibility and security evidence | Pending implementation |