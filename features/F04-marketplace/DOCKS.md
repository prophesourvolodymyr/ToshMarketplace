# F04 — Tosh Marketplace Platform

F04 is the shared marketplace platform for Tosh products. It separates public discovery from private publisher operations and from host-owned installation, permissions, verification, and runtime execution.

## What We Build

- Public versioned catalog routes for published products, hosts, components, widgets, capabilities, release notes, and safe trust metadata.
- Anonymous web catalog and static product/widget detail pages owned by `ToshMarketplace/`.
- Publisher identity, product/component/widget/release records, submission validation, review, quarantine, revocation, and immutable artifact boundaries.
- Private publisher routes protected by the account authorization boundary.
- Host-specific compatibility context and, in a later slice, authenticated installation handoff.
- Versioned service contracts consumed by host clients without executing package code in the marketplace.

The public web slice does not implement publisher authentication, package download, signed handoff, host installation, runtime execution, live deployment, PostgreSQL/S3 operations, or Swift clients.

## Architecture

```text
anonymous browser
  ├── same-origin /catalog and /products/:id shell
  ├── GET /v1/catalog/products
  ├── GET /v1/hosts
  └── GET /v1/products/:id[?hostID=]
          │
          ▼
ToshMarketplace service
  ├── CatalogService — public projection and publication filtering
  ├── PublishingService — private submission/review/quarantine lifecycle
  ├── storage boundary — memory, PostgreSQL, file/S3 implementations
  └── host-owned installation boundary — pending
```

`ToshMarketplace/` is the long-term owner. `../NotchinTosh/marketplace/` is preserved reference code and is never imported by the target runtime.

## Boundaries and Privacy

- Public catalog output contains only active-publisher, published-product, published-release metadata and declared capabilities.
- The service may retain artifact/signature fields in the existing `/v1` compatibility envelope. Browser view models must discard artifact paths, digests, signatures, public keys, contact email, review/submission data, settings/actions/ports, and runtime data before rendering.
- Host compatibility is described from server-returned host IDs and host-scoped components. The browser never derives installability from artifact presence.
- A compatible host is informative in this phase. No package URL, installation button, deep link, or signed handoff is exposed.
- Preview paths are untrusted metadata. Without a public asset endpoint they are rendered as safe fallback text/icon context, never as an image or CSS URL.
- External `http:` and `https:` links are allowed only for documented source, license, support, privacy, and host download contexts. Other schemes are rejected.

## Current Feature Scope

### F04-A/F04-B — Verified Service

The independent Bun/TypeScript service owns domain models, public catalog filtering, storage contracts, publishing validation, signing, review, quarantine, rate limiting, HTTP routing, and privacy assertions. Existing service routes and response envelopes remain unchanged.

### F04-C — Public Web Catalog

F04-C adds the framework-free browser module, typed route/API/view-model boundary, accessible editorial catalog/detail surface, same-origin shell handler, deterministic fake fixture, and browser/contract evidence described in the child document.

### Remaining F04 Areas

Publisher dashboard, account flows, production PostgreSQL/S3/Tosh-account deployment, signed host installation handoff, package download/verification UX, Swift marketplace clients, host runtime integration, and operational evidence remain pending and must not be marked complete by F04-C.

## States

| Boundary | States and behavior |
|---|---|
| Catalog service | Published results, empty results, host-filtered results, unavailable product, quarantined/revoked release excluded |
| Browser catalog | Loading skeleton, ready results, empty/reset, no-hosts context, API error with retry, offline-unavailable |
| Browser detail | Loading skeleton, ready detail, selected-host compatible context, incompatible/unavailable host context, product not found, API error with retry, offline-unavailable |
| Publisher service | Private authorization, validation, review, approved/published, quarantined/revoked lifecycle |
| Host handoff | Not implemented in F04-C; later work owns signed handoff, host download, verification, permissions, installation, update, rollback, and quarantine |

## Dependencies

- `../STYLES.md` — shared web visual language, typography, spacing, motion, accessibility, and trusted-catalog rules.
- `src/domain.ts`, `src/catalog.ts`, `src/http.ts` — public service contracts.
- `../../NotchinTosh/features/F4-MArketplace/` — preserved behavioral/reference documentation only.
- ToshSDK and each host app — future package, compatibility, installation, permission, and runtime contracts.

The F04-C child must be verified against the existing service tests before broader F04 work continues. Live PostgreSQL, S3/object storage, Tosh account credentials, CDN, signed handoff, host installation, and deployment remain external and unverified here.

## Verification

| Scenario | Expected result | Evidence |
|---|---|---|
| Existing service contracts | Existing public/private routes and privacy assertions remain unchanged | Passed 2026-08-03: `bun test` 32/32 with 0 failures, including original 22 service tests and additive capabilities assertion |
| Anonymous web catalog | Browser reaches catalog without login and displays only safe public metadata | Passed 2026-08-03: Chrome 150.0.0.0 at 1440x1000 and fake fixture browse/search/host/reset/retry flows |
| Product detail and compatibility | Detail shows public product data; incompatible selected host has no install/deep-link CTA | Passed 2026-08-03: focus detail refresh and Weather Window + NotchinTosh incompatible state verified; alternative LaunchinTosh context only |
| Publisher/privacy boundary | Browser contains no private publisher, artifact, signing, review, package-path, or runtime values | Passed 2026-08-03: view-model/render tests and DOM scans found no forbidden values or unsafe preview/image URL |
| Responsive/reduced motion | Desktop and narrow catalog/detail remain usable; reduced motion preserves content and removes nonessential motion | Passed 2026-08-03: Chrome 390x844 no horizontal overflow with stacked detail; reduced-motion loading-to-ready and route navigation remained usable |
| External integrations | Live PostgreSQL, S3, Tosh account, CDN, host installation, signed handoff, and deployment | Unverified by design in this phase |
