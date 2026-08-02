# CYCLES.md — ToshMarketplace

**Planned with user:** 2026-08-01

This project owns the marketplace service and future web/API platform. The F04-A/F04-B deterministic service migration from `../NotchinTosh/marketplace/` is verified; new marketplace implementation work belongs here, and the sibling copy remains preserved as reference code.

## Cycle 0 — Repository Foundation

- [x] Initialize the ToshMarketplace repository on `main`
- [x] Add `ECOSYSTEM.md` and repository ownership rules
- [x] Add `DOCKS.md` with marketplace states, boundaries, and verification
- [x] Define the migration boundary from NotchinTosh

## Cycle 1 — Reference Service Migration

- [x] F04-A core migration — copy the verified domain, catalog, storage, validation, HTTP, PostgreSQL, object-storage, and account-authorization service into the independent package
- [x] F04-B publishing migration — copy publishing, review, quarantine, signing, rate-limit, and deterministic lifecycle behavior with both test files
- [x] Preserve shared behavior — keep public exports, HTTP contracts, validation/signing semantics, immutable storage boundaries, authorization rules, and JSONB migration schema unchanged
- [x] Target verification — run `bun install --frozen-lockfile`, `bun run typecheck`, focused boundary tests 8/8, and full tests 22/22 with 0 failures
- [x] Security and file boundary — scan target source/config/migration paths and confirm no sibling imports, credentials, signing material, runtime data, or generated artifacts are tracked
- [x] Documentation evidence — record target ownership, preserved NotchinTosh reference status, exact Bun/Swift counts, and live-service limitations
- [x] Commit and push evidence — deliver the migration on `main` through `origin/main` after the documented checks pass

## Cycle 2 — Marketplace Service Completion

- [ ] Complete publisher dashboard and release operations
- [ ] Add production deployment configuration without committing secrets
- [ ] Verify external PostgreSQL, object storage, and Tosh account integrations
- [ ] Add operational evidence for quarantine, rollback, appeals, and audit retention

## Cycle 3 — Public Web Marketplace

- [ ] Build anonymous public catalog and static product/widget pages
- [ ] Add host compatibility filtering and deep-link installation handoff
- [ ] Add authenticated publisher dashboard
- [ ] Verify public/private metadata and privacy boundaries

## Cycle 4 — Host Clients

- [ ] Build versioned Swift marketplace client contracts
- [ ] Add NotchinTosh embedded client and installation flow
- [ ] Add host-specific component filtering, permission handoff, update, rollback, and quarantine
- [ ] Add additional Tosh host clients only after their host contracts are verified
