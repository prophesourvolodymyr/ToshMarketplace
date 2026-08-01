# Phase 1 of F04 — Reference Service Migration

## Features Included
- F04-A — Tosh Marketplace Core
- F04-B — Tosh Marketplace Publishing System

Each included feature must be migrated, tested, documented, committed, and checked off in `ToshMarketplace/CYCLES.md` separately where applicable.

## Context
`ToshMarketplace/` is now the designated long-term marketplace repository, but it contains documentation only. The verified Bun/TypeScript F04-A/F04-B service still lives in the sibling `NotchinTosh/marketplace/` reference path. Migrate that service here before building the web catalog, Swift client, or host installation flow.

## What You Need to Read First
- `DOCKS.md`
- `ECOSYSTEM.md`
- `CYCLES.md`
- `../NotchinTosh/features/F4-MArketplace/DOCKS.md`
- `../NotchinTosh/features/F4-MArketplace/F04-A-marketplace-core/DOCKS.md`
- `../NotchinTosh/features/F4-MArketplace/F04-B-publishing-system/DOCKS.md`
- `../NotchinTosh/marketplace/package.json`
- `../NotchinTosh/marketplace/tsconfig.json`
- `../NotchinTosh/marketplace/bun.lock`
- `../NotchinTosh/marketplace/src/`
- `../NotchinTosh/marketplace/migrations/`
- `../NotchinTosh/F04-MArketplace-External-Analysis.md`
- `../NotchinTosh/F04-MArketplace-Research-Summary.md`

## What Happened Last Session
The repository scaffolds and ownership documentation were created and pushed. The source service is already verified in `NotchinTosh/marketplace/`: `bun run typecheck` passes, the full deterministic Bun suite passes 22 tests, focused service-boundary tests pass 8 tests, and the NotchinTosh Swift suite passes 43 tests. The source copy remains intact and must not be deleted or rewritten during migration.

## What to Build

1. Migrate the complete reference service into this repository without changing behavior:
   - `package.json`
   - `bun.lock`
   - `tsconfig.json`
   - `src/domain.ts`
   - `src/catalog.ts`
   - `src/storage.ts`
   - `src/validation.ts`
   - `src/publishing.ts`
   - `src/http.ts`
   - `src/postgres.ts`
   - `src/object-storage.ts`
   - `src/account-authorization.ts`
   - `src/index.ts`
   - `src/marketplace.test.ts`
   - `src/service-boundaries.test.ts`
   - `migrations/001_marketplace_entities.sql`
2. Preserve the existing public exports, `/v1` HTTP JSON error shape, package validation, digest/signature behavior, PostgreSQL transaction boundary, immutable object-storage boundary, publisher authorization, review pipeline, quarantine behavior, and privacy guards.
3. Keep the service package private and environment-configured. Never copy credentials, tokens, signing keys, local `.env` files, build output, or runtime user data.
4. Keep the target repository self-contained. Do not make it depend on `NotchinTosh/marketplace/` at runtime or through a path import.
5. Run the target service independently from `ToshMarketplace/`; do not rely on the source repository's `node_modules`, lockfile, generated output, or build directory.
6. After the target passes, update `DOCKS.md` and `CYCLES.md` with exact migration and test evidence. Update the root and NotchinTosh F04 ownership notes so they state that new marketplace service work belongs in `ToshMarketplace/` while the NotchinTosh copy remains a preserved reference.

## Files to Create/Modify

- create: `package.json`
- create: `bun.lock`
- create: `tsconfig.json`
- create: `src/` service and deterministic tests listed above
- create: `migrations/001_marketplace_entities.sql`
- modify: `DOCKS.md`
- modify: `ECOSYSTEM.md`
- modify: `CYCLES.md`
- modify: `../CYCLES.md`
- modify: `../NotchinTosh/CYCLES.md`
- modify: `../NotchinTosh/features/F4-MArketplace/DOCKS.md`

Do not delete `../NotchinTosh/marketplace/` in this phase. If the reference repository needs documentation updates, commit those documentation changes in its own repository after the target migration is verified.

## Verification

- From `ToshMarketplace/`, `bun install --frozen-lockfile` or the repository-equivalent lockfile-safe install succeeds.
- From `ToshMarketplace/`, `bun run typecheck` passes.
- From `ToshMarketplace/`, `bun test` passes with the migrated deterministic suite; record the exact count and require zero failures.
- The target tests cover catalog filtering, multi-host products, compatibility rejection, package validation, signature/digest checks, release immutability, quarantine, privacy, SQL parameter/transaction behavior, immutable artifact storage, account authorization, HTTP status mapping, review agreement/disagreement, and rate limiting.
- The target repository has no source import or runtime dependency on `../NotchinTosh/marketplace/`.
- No credentials, signing keys, tokens, `.env` files, package artifacts, or runtime user data are present in the target diff.
- The original NotchinTosh reference service remains unchanged and still passes its existing `bun run typecheck && bun test` suite.
- The NotchinTosh Swift regression suite still passes with `swift test` from `../NotchinTosh/NotchinTosh`.
- Capture target and reference test commands, exact counts, migration status, and any external-service limitations in the relevant DOCKS tables.

## Agent Rules (Mandatory — DO NOT SKIP)

1. **NO SUB-AGENTS:** Do not spawn sub-agents. Do all work yourself in this session.
2. **COMMIT AFTER DONE:** Commit the completed migration in `ToshMarketplace` with a clear message after verification. If root or NotchinTosh documentation changes are made, commit them in their owning repositories too.
3. **PUSH AFTER COMMIT:** Push each changed repository to its configured `origin/main` after verification.
4. **UPDATE CYCLES.md:** Mark only migration tasks verified by evidence as `[x]` in the owning `CYCLES.md` files.
5. **NO IDE TODO SYSTEMS:** Do not create IDE-specific task files.
6. **COMPLETE THE WHOLE SLICE:** Migrate, test, document, verify, commit, and push. Do not hand off only testing.
7. **PRESERVE THE REFERENCE:** Never delete the NotchinTosh service until the target is verified and a separate migration decision authorizes removal.
8. **PRESERVE SECURITY BOUNDARIES:** Never log credentials, trust client-supplied actor identity, persist package bytes in metadata, or use unsafe filesystem/object paths.
9. **NO PRODUCTION CLAIM WITHOUT EVIDENCE:** Passing injected tests proves the boundary contract, not live PostgreSQL, S3, or account deployment behavior. Record that limitation.

## When You Finish

Report:

- Target repository files and package boundary migrated.
- Public exports and runtime behavior preserved.
- Target typecheck and full test count.
- Reference test count and Swift regression result.
- Documentation and cycle updates.
- Commit hashes and pushed branches for each changed repository.
- Whether live PostgreSQL, object storage, and account credentials remain unverified.

## Scope Decision Before Finish

- Completed: reference marketplace service migrated into `ToshMarketplace/`, independently tested, documented, committed, and pushed.
- Remaining: publisher dashboard completion, public web catalog, Swift marketplace client, host installation/runtime integration, and live service deployment.
- Next-scope estimate: create the next prompt only for a substantial web catalog or publisher-operations slice after migration verification.
- Decision: no next prompt is needed for migration cleanup; generate one only for the next substantial marketplace feature.