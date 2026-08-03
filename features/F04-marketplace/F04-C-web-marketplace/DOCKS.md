# F04-C — Public Web Catalog

F04-C is the anonymous, same-origin Tosh Marketplace catalog and public product/widget detail surface owned by `ToshMarketplace/`. It presents safe public metadata and host compatibility context without executing widget code or pretending that package artifacts are browser assets.

## What We Build

- A framework-free browser module bundled by Bun from `src/web/catalog.ts`.
- Catalog routes at `/` and `/catalog`, and product routes at `/products/:id`; other browser paths return a safe 404.
- Typed route state preserving search text, selected host, page, page size, and detail return context.
- API calls to the existing public `/v1` contracts only:
  - `GET /v1/catalog/products?q=&hostID=&page=&pageSize=`
  - `GET /v1/hosts`
  - `GET /v1/products/:id` or `GET /v1/products/:id?hostID=`
- Safe public catalog cards and product detail view models that discard private and artifact metadata.
- Public host names, icons, compatibility context, and allowlisted host download links as context only.
- Explicit loading, ready, empty, no-hosts, unavailable/not-found, API-error, and offline states with retry/reset actions.
- Accessible semantic markup, visible focus, keyboard navigation, stable loading skeletons, reduced-motion support, and responsive desktop/narrow layouts.
- An injectable same-origin web handler, fake-backed `bun run web` fixture, and deterministic browser contract tests.

## Ownership and Reference

`ToshMarketplace/` is the long-term implementation owner. [`../../../NotchinTosh/features/F4-MArketplace/F04-C-web-marketplace/DOCKS.md`](../../../NotchinTosh/features/F4-MArketplace/F04-C-web-marketplace/DOCKS.md) is a behavioral and requirements reference only. It is not a runtime dependency, is read-only, and must not be imported or copied into web assets.

## Architecture

```text
src/web/index.html + catalog.css
             │
             ▼
src/web/catalog.ts
  ├── parseRoute/catalogURL/productURL
  ├── typed MarketplaceAPI client
  ├── safe catalog/detail view-model projection
  ├── UI state machine and retry-preserving route state
  └── escaped DOM rendering and event wiring
             │ same-origin fetch
             ▼
createMarketplaceWebHandler
  ├── delegates /v1/* to unchanged createMarketplaceHandler
  ├── serves known CSS/JS assets
  ├── serves shell for /, /catalog, /products/:id
  └── safe 404 for all other paths
             │
             ▼
CatalogService / Memory fixture
```

The browser owns presentation state only. It does not filter catalog results, select releases, infer compatibility from artifacts, read package files, execute generated widget output, access credentials, or import sibling repositories.

## Routes and URL State

| Route | Meaning | State behavior |
|---|---|---|
| `/` | Catalog entry point | Equivalent to `/catalog`; preserves `q`, `hostID`, `page`, and `pageSize` |
| `/catalog` | Catalog page | Search and host controls update this URL; reset returns to safe defaults |
| `/products/:id` | Product detail | Carries optional `hostID`; `returnText` preserves the catalog search text for the back link |
| Other path | Not found | Browser app shows a readable safe 404 only when served by the handler |

`parseRoute()` clamps invalid page/pageSize values to the service defaults (page 1, page size 24, maximum page size 100). Product links carry the selected host and current search text. The detail back link restores the catalog URL and context.

## Public API and View-Model Boundary

The browser client checks `Response.ok`, parses the existing `apiVersion: "v1"` envelope, and uses sanitized typed errors containing only endpoint kind/status and safe copy. It never displays API-provided error messages that could reveal private details.

Catalog cards retain only product ID, publisher display name, name, icon label, short description, tags, widget count, compatible host IDs, and current public versions. Detail models retain public product fields, screenshots/widget preview descriptors, public component host/package/bridge/release-channel values, release version/notes/compatibility, widget name/icon/description/preview/sizes/states, declared capabilities, and optional source/license/support/privacy links.

The detail renderer never copies or displays `release.artifact`, `objectKey`, digest, signature, public-key, publisher contact email/signing key, settings/actions/ports, review/submission, unpublished, or runtime data. `WidgetPreview.path` is untrusted. `safePreviewURL()` returns `undefined` for service-provided paths in this phase; previews use a safe text/icon fallback and no path reaches `img.src`, CSS URLs, DOM attributes, or visible text.

A selected host is compatible only when the server response provides that host in `compatibleHostIDs` and returns a host-scoped component. If no component is returned, the UI says the product is incompatible/unavailable for that host, shows valid alternative host/download context only, and renders no install/deep-link CTA. Missing host data never becomes universal compatibility.

External links are allowed only for source, license, support, privacy, and host download URLs after `http:`/`https:` validation. `deepLinkScheme` is never rendered as an installation link.

## UI Structure and Visual Direction

The visual direction is a quiet editorial “field guide” catalog, not a dashboard or generic card wall.

- A dark graphite masthead rail contains the Tosh Marketplace wordmark and a compact search/host context line.
- The catalog begins with an asymmetric featured-result band, then an intrinsic responsive product grid.
- Each product card represents one product. A large safe fallback preview leads; publisher, compatibility, trust, tags, and release metadata remain subordinate; one discover action is clear.
- Product detail uses a two-column preview/identity layout on wide windows and stacks into readable disclosure sections on narrow windows.
- Compatibility appears as labeled text chips and explanatory copy, never color alone.
- Semantic CSS variables are required for `canvas`, `surface`, `surfaceSecondary`, `textPrimary`, `textSecondary`, `textTertiary`, `separator`, `accent`, `success`, `warning`, `danger`, and `focusRing`.
- The web font stack follows the shared design system: `-apple-system`, `BlinkMacSystemFont`, `sans-serif`; code-like IDs/versions use `ui-monospace`, `monospace`.
- Spacing follows the four-point grid; cards use 12px radii, primary surfaces 16px, and low-depth broad shadows.

## States and Behavior

| State | Catalog behavior | Detail behavior |
|---|---|---|
| Loading | Replace results with stable skeleton cards; no stale result markup | Replace detail with stable skeleton sections; no stale detail markup |
| Ready | Search form, host select, reset controls, result summary, cards, detail links | Product/publisher identity, safe preview, widgets, sizes/states, capabilities, versions, notes, compatibility, safe links |
| Empty | Explain no matching products; expose text and host reset controls | Not applicable |
| No hosts | Keep catalog/detail public metadata readable, say host compatibility is unavailable, never claim universal compatibility | Same; no install/handoff action |
| Not found/unavailable | N/A | Readable unavailable page with catalog link and preserved route/search context |
| API error | Safe endpoint-specific copy, retry action, preserve query/host URL state | Same, preserving product/host/return context |
| Offline | Say public metadata is unavailable offline; no cache or network-dependent handoff | Same; retry returns to the same route |
| Incompatible selected host | Cards may remain discoverable only when returned by service; detail explicitly says unavailable for selected host | No component/install/deep-link CTA; valid alternative host/download context may remain |

Every status/error announcement uses an `aria-live` region. Error details are safe and copyable only when they contain endpoint kind/status, never raw API text.

## Accessibility and Motion

- Use `header`, `nav`, `main`, `form`, visible `label`, `select`, `section`, `article`, `a`, `button`, headings, and lists.
- Text and attributes are built with `textContent`/DOM APIs or escaped by a proven `escapeHTML()` invariant. Static class/id names are the only unescaped markup.
- Controls are keyboard operable with logical tab order, Enter/Space activation, visible high-contrast focus, and Escape dismissal for transient filter UI if introduced.
- Search → host filter → product link traversal must be usable without a pointer.
- CSS transitions are limited to selection/focus and short surface fades. Loading motion is calm and nonessential.
- `prefers-reduced-motion: reduce` disables transforms, staggered reveals, and continuous loading motion while preserving direct state replacement, content, focus, and navigation.
- Narrow layouts stack cards/details, avoid horizontal overflow, and keep controls usable at 390x844.

## Serving Seam

`loadMarketplaceWebAssets()` reads the static HTML/CSS and bundles the browser module once in memory with `Bun.build({ target: "browser" })`; it never writes generated JavaScript to the repository. `createMarketplaceWebHandler()` delegates every `/v1/...` request to the unchanged marketplace handler, serves only known assets and shell routes, sets correct content types, preserves API response status/headers, and returns a safe 404 elsewhere. Injectable assets make tests independent of filesystem and live services.

`dev-fixture.ts` seeds only public-safe fake publishers, two active hosts, published products/components/widgets/releases, one multi-host product, one host-specific product, allowlisted external metadata links, and deliberately unsafe preview path metadata. It includes no private keys, credentials, contact emails, package archives, sibling imports, or generated widget output. `dev-server.ts` uses `MemoryArtifactStore`, deny-all publisher authorization, and `createMarketplaceWebServer()`.

## Files

- `src/domain.ts` — additive public `CatalogComponent.capabilities` type field.
- `src/catalog.ts` — additive capabilities projection; existing filtering and privacy assertion remain unchanged.
- `src/web/catalog.ts` — browser routes, API client, view models, safe rendering, UI states, and interactions.
- `src/web/index.html` — stable app root, title, CSS and browser bundle references.
- `src/web/catalog.css` — semantic tokens, responsive editorial layout, focus, and reduced-motion rules.
- `src/web/server.ts` — in-memory asset loading and injectable web handler/server seam.
- `src/web/dev-fixture.ts` — deterministic public-safe browser fixture.
- `src/web/dev-server.ts` — `bun run web` entry point.
- `src/web/catalog.test.ts` — deterministic route/API/view-model/render/state/handler contract tests.
- `package.json` — dependency-free `web` script only.
- `src/index.ts` — additive web server export only if the package boundary consumes it.

## Dependencies

- F04-A/F04-B service contracts and their existing deterministic tests must remain passing.
- `src/http.ts` public route handler is unchanged and is delegated to, not duplicated.
- `src/domain.ts` public models define the mapping boundary; capabilities are additive only.
- `../STYLES.md` defines semantic tokens, system typography, four-point spacing, motion, accessibility, and trusted catalog rules.
- Preserved reference: `../../../NotchinTosh/features/F4-MArketplace/F04-C-web-marketplace/DOCKS.md` (pattern/requirements only, not runtime).

## Verification

| Test scenario | Expected result | Evidence |
|---|---|---|
| Frozen install and typecheck | Dependency-free web scripts install with lockfile unchanged; strict TypeScript passes | Passed 2026-08-03: `bun install --frozen-lockfile` reported no changes; `bun run typecheck` exited 0 on Bun 1.3.11 |
| Route parsing/URL generation | Catalog/product/invalid paths, host/search/page state, and detail return context are deterministic | Passed 2026-08-03: focused suite 10/10; root, `/catalog`, clamped page/pageSize, selected-host product, encoded product ID, invalid route, and reset URLs asserted |
| API requests | Exact catalog/host/detail URLs; existing `v1` envelope fields remain intact | Passed 2026-08-03: focused suite 10/10; exact four request paths and `apiVersion`, `items`, `page`, `pageSize`, `total` asserted |
| Safe projection/rendering | Required public copy renders; artifact/package/signing/private/runtime/unsafe preview values never render or become URLs | Passed 2026-08-03: focused suite 10/10; view model/markup excludes artifact, object key, digest, signature, public key, package paths, review/private/runtime values; unsafe preview yields no image source; escaped text and URL scheme tests pass |
| UI states | Loading, ready, empty/reset, no-hosts, not-found, API error/retry, offline preserve context | Passed 2026-08-03: focused suite 10/10; deterministic render states and Chrome aborted-request Retry flow preserve search/host/product context |
| Incompatible host | Explicit incompatible/unavailable text; no component/install/deep-link CTA; alternative context only | Passed 2026-08-03: focused suite 10/10 and Chrome 150.0.0.0 at 1440x1000; Weather Window + NotchinTosh says unavailable, returns LaunchinTosh download context, and exposes no install/deep-link action |
| Web handler | `/v1` delegates unchanged; shell serves catalog/detail refresh; known assets have correct content type; other paths are safe 404 | Passed 2026-08-03: focused suite 10/10; in-memory asset smoke and handler assertions preserve status/headers and cover `/`, `/catalog`, `/products/:id`, CSS, JS, `/v1`, and safe 404 |
| Existing service regression | Focused web tests and full suite pass with the additive capability assertion | Passed 2026-08-03: `bun test src/web/catalog.test.ts` 10/10 with 0 failures; `bun test` 32/32 with 0 failures and 209 expectations; capability projection plus existing 22 service tests remain passing |
| Browser desktop | Chromium reaches catalog anonymously, searches, filters, opens/refreshes detail, resets, retries, keyboard navigates, and shows safe states at 1440x1000 | Passed 2026-08-03: Chrome 150.0.0.0, 1440x1000; anonymous browse, `weather` search, LaunchinTosh filter, detail navigation/refresh, empty/reset, aborted catalog request + Retry, keyboard Search → Host → product Enter, no horizontal overflow; screenshots `/var/folders/f2/k3zmhjfx5yd6x965gw58m3m00000gn/T/omp-sshots-1549619f4b096184.webp`, `/var/folders/f2/k3zmhjfx5yd6x965gw58m3m00000gn/T/omp-sshots-1549633a51c96185.webp`, `/var/folders/f2/k3zmhjfx5yd6x965gw58m3m00000gn/T/omp-sshots-154963709f896186.webp` |
| Browser narrow/reduced motion | 390x844 has no horizontal overflow and readable stacked content; reduced motion removes nonessential motion without losing function | Passed 2026-08-03: Chrome 150.0.0.0 at 390x844 reported `scrollWidth === 390`, one-column card/detail layouts, preserved back URL; `prefers-reduced-motion: reduce` reported match, loading animation `1e-05s`, no stale product, and ready navigation remained usable |
| External integrations | PostgreSQL, S3/object storage, Tosh account, CDN, signed handoff, host installation, and deployment | Explicitly unverified in F04-C; fake MemoryMarketplaceStore/MemoryArtifactStore fixture only |
