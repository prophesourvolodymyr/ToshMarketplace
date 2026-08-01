# CYCLES.md — ToshMarketplace

**Planned with user:** 2026-08-01

This project owns the marketplace service and future web/API platform. During migration, `../NotchinTosh/marketplace/` is the verified reference copy. New marketplace implementation work moves here only after the migration slice passes.

## Cycle 0 — Repository Foundation

- [x] Initialize the ToshMarketplace repository on `main`
- [x] Add `ECOSYSTEM.md` and repository ownership rules
- [x] Add `DOCKS.md` with marketplace states, boundaries, and verification
- [x] Define the migration boundary from NotchinTosh

## Cycle 1 — Reference Service Migration

- [ ] Copy the verified F04-A/F04-B Bun service into `src/`, `tests/`, `migrations/`, and package configuration
- [ ] Preserve domain, catalog, validation, publishing, HTTP, PostgreSQL, object-storage, and account-authorization behavior
- [ ] Run `bun run typecheck` and the full deterministic `bun test` suite in this repository
- [ ] Confirm no production credentials, tokens, signing keys, or runtime user data are copied
- [ ] Update migration evidence in `DOCKS.md` and the root F04 documentation
- [ ] Commit and push the migrated service to `origin/main`

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
