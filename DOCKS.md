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

## Repository Migration Boundary

`ToshMarketplace/` now owns the verified F04-A/F04-B Bun and TypeScript marketplace service. The service, tests, package boundary, lockfile, configuration, and migration were copied from `../NotchinTosh/marketplace/` and verified independently on 2026-08-01. New marketplace service work belongs here; `NotchinTosh/marketplace/` remains intact as a preserved historical/reference copy.

The migration is complete for the deterministic service slice. This repository does not yet own the public web catalog, publisher dashboard, production integrations, Swift clients, or host installation/runtime work.

The first implementation slice in this repository is the reference-service migration. It is not the web catalog, Swift client, or host installation work.

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

- `package.json`, `bun.lock`, `tsconfig.json`, `.gitignore` — private Bun/TypeScript service package, locked dependencies, strict compiler settings, and generated-file boundary.
- `src/` — migrated domain, catalog, storage, validation, publishing, HTTP, PostgreSQL, object-storage, and Tosh account-authorization service modules.
- `src/marketplace.test.ts` — 14 deterministic marketplace catalog, validation, publishing, review, quarantine, privacy, signing, and rate-limit tests.
- `src/service-boundaries.test.ts` — 8 deterministic PostgreSQL, object-storage, account-authorization, actor, and HTTP boundary tests.
- `migrations/001_marketplace_entities.sql` — unchanged JSONB marketplace metadata schema and indexes.

## Dependencies

- Root `../STYLES.md` for web visual language.
- Root `../ECOSYSTEM.md` and `../DOCKS.md` for shared ownership.
- `ToshSDK` for package and host compatibility contracts.
- Each host app for installation, permissions, runtime, and rollback behavior.

The evidence below covers the independent deterministic package and preserved regressions. PostgreSQL, S3/object storage, and Tosh account credentials/deployment remain unverified because the tests use fakes rather than live external services.

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
| Target migration | The service package and unchanged JSONB migration are independent in `ToshMarketplace/`; no runtime path imports the sibling source repository | Passed 2026-08-01: copied package/config/migration and 12 service source/test files; portable signed-directory validation passed |
| Target package verification | Frozen install, strict typecheck, focused boundary suite, and full deterministic suite pass | Passed 2026-08-01: `bun install --frozen-lockfile`; `bun run typecheck`; `bun test src/service-boundaries.test.ts` 8/8 with 0 failures; `bun test` 22/22 with 0 failures (14 marketplace + 8 boundary) |
| Preserved source regression | The NotchinTosh service remains present and behaviorally unchanged | Passed 2026-08-01: `NotchinTosh/marketplace/` `bun run typecheck && bun test` 22/22 with 0 failures; `git diff --exit-code -- marketplace` clean |
| Swift host regression | Host runtime remains compatible after migration | Passed 2026-08-01: `NotchinTosh/NotchinTosh/` `swift test` 43/43 with 0 failures |
| Security and file boundary | No source-repository imports, credentials, signing material, runtime data, or generated artifacts enter the target migration | Passed 2026-08-01: target source/config/migration scan found no `../NotchinTosh` or `NotchinTosh/marketplace` path; untracked migration list contains only declared files; `node_modules/`, `.env*`, `dist/`, `build/`, `coverage/`, `*.tgz`, and `*.notchbridge` are ignored |