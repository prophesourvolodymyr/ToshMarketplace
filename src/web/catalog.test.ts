import { describe, expect, test } from "bun:test";

import { createMarketplaceHandler } from "../http";
import { createMarketplaceWebFixture } from "./dev-fixture";
import {
  MarketplaceAPI,
  MarketplaceAPIError,
  PRODUCT_DETAIL_TABS,
  catalogURL,
  parseProductDetailTab,
  parseRoute,
  productURL,
  widgetPreviewURL,
  renderCatalogState,
  renderProductState,
  safeExternalURL,
  safePreviewURL,
  toCatalogViewModel,
  toProductViewModel,
  type CatalogURLState,
} from "./catalog";
import { INSTALLED_APPS } from "./marketplace-presentation";
import { createMarketplaceWebHandler, createMarketplaceWidgetPreviewHandler, type MarketplaceWebAssets } from "./server";

const catalogState: CatalogURLState = { text: "focus mode", hostIDs: ["notchintosh"], page: 2, pageSize: 48, tab: "discover", category: "all" };

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

async function fixtureData() {
  const fixture = await createMarketplaceWebFixture();
  const hosts = await fixture.catalog.listHosts();
  const page = await fixture.catalog.search();
  const detail = await fixture.catalog.getProduct("product.focus-field-guide");
  if (!detail) throw new Error("Fixture detail was not seeded.");
  return { fixture, hosts, page, detail };
}

describe("F04-C browser route contracts", () => {
  test("parses catalog tabs/categories, product detail hashes, selected hosts, search, paging, and invalid routes", () => {
    expect(parseRoute(new URL("https://marketplace.test/")).kind).toBe("catalog");
    expect(parseRoute(new URL("https://marketplace.test/catalog?q=focus%20mode&hostID=notchintosh&page=0&pageSize=999&tab=updates&category=work"))).toEqual({
      kind: "catalog",
      state: { text: "focus mode", hostIDs: ["notchintosh"], page: 1, pageSize: 100, tab: "updates", category: "work" },
    });
    expect(parseRoute(new URL("https://marketplace.test/catalog?tab=unknown&category=unknown"))).toEqual({
      kind: "catalog",
      state: { text: "", hostIDs: [], page: 1, pageSize: 24, tab: "discover", category: "all" },
    });
    expect(parseRoute(new URL("https://marketplace.test/catalog?hostID=notchintosh&hostID=launchintosh&hostID=notchintosh"))).toEqual({
      kind: "catalog",
      state: { text: "", hostIDs: ["notchintosh", "launchintosh"], page: 1, pageSize: 24, tab: "discover", category: "all" },
    });
    expect(parseRoute(new URL("https://marketplace.test/products/product.focus-field-guide?hostID=notchintosh&hostID=launchintosh&q=focus%20mode#ratings"))).toEqual({
      kind: "product",
      productID: "product.focus-field-guide",
      hostID: undefined,
      returnHostIDs: ["notchintosh", "launchintosh"],
      returnText: "focus mode",
      detailTab: "ratings",
    });
    expect(parseProductDetailTab("#not-a-tab")).toBe("overview");
    expect(PRODUCT_DETAIL_TABS).toEqual(["overview", "ratings", "updates", "privacy"]);
    expect(parseRoute(new URL("https://marketplace.test/products/product%2Fwith-slash"))).toEqual({ kind: "product", productID: "product/with-slash", hostID: undefined, returnHostIDs: [], returnText: "", detailTab: "overview" });
    expect(parseRoute(new URL("https://marketplace.test/publishers/private"))).toEqual({ kind: "not-found" });
    expect(parseRoute(new URL("https://marketplace.test/products/%E0%A4%A"))).toEqual({ kind: "not-found" });
    expect(catalogURL(catalogState)).toBe("/catalog?q=focus+mode&hostID=notchintosh&page=2&pageSize=48");
    expect(catalogURL({ text: "focus", hostIDs: ["notchintosh"], page: 1, pageSize: 24, tab: "updates", category: "work" })).toBe("/catalog?tab=updates&q=focus&hostID=notchintosh&category=work");
    expect(catalogURL({ text: "", hostIDs: ["notchintosh", "launchintosh"], page: 1, pageSize: 24, tab: "discover", category: "all" })).toBe("/catalog?hostID=notchintosh&hostID=launchintosh");
    expect(productURL("product.focus-field-guide", "notchintosh", "focus mode", ["notchintosh", "launchintosh"])).toBe("/products/product.focus-field-guide?hostID=notchintosh&hostID=launchintosh&q=focus+mode");
    expect(catalogURL({ text: "", hostIDs: [], page: 1, pageSize: 24, tab: "discover", category: "all" })).toBe("/catalog");
  });
});

describe("F04-C browser API client", () => {
  test("uses exact public API request URLs and excludes presentation query state", async () => {
    const requests: string[] = [];
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      requests.push(String(input));
      if (String(input).startsWith("/v1/catalog/products")) return jsonResponse({ apiVersion: "v1", items: [], page: 1, pageSize: 24, total: 0 });
      if (String(input) === "/v1/hosts") return jsonResponse([]);
      if (String(input) === "/v1/products/product.focus-field-guide") return jsonResponse({ productID: "product.focus-field-guide", components: [] });
      if (String(input) === "/v1/products/product.focus-field-guide?hostID=notchintosh") return jsonResponse({ productID: "product.focus-field-guide", components: [] });
      return new Response("missing", { status: 404 });
    };
    const api = new MarketplaceAPI(fetcher);
    const page = await api.search({ text: "focus", hostIDs: ["notchintosh", "launchintosh"], page: 1, pageSize: 24, tab: "updates", category: "work" });
    await api.listHosts();
    await api.getProduct("product.focus-field-guide");
    await api.getProduct("product.focus-field-guide", "notchintosh");
    expect(requests).toEqual([
      "/v1/catalog/products?q=focus&page=1&pageSize=24&hostID=notchintosh&hostID=launchintosh",
      "/v1/hosts",
      "/v1/products/product.focus-field-guide",
      "/v1/products/product.focus-field-guide?hostID=notchintosh",
    ]);
    expect(requests.every((request) => !request.includes("tab=") && !request.includes("category="))).toBe(true);
    expect(page).toEqual({ apiVersion: "v1", items: [], page: 1, pageSize: 24, total: 0 });
  });

  test("sanitizes response and network errors without exposing API body details", async () => {
    const apiError = new MarketplaceAPI(async () => new Response(JSON.stringify({ error: { message: "private signing detail" } }), { status: 500 }));
    await expect(apiError.listHosts()).rejects.toEqual(expect.objectContaining({ endpoint: "hosts", status: 500, message: "Host compatibility information is temporarily unavailable." }));
    const offlineError = new MarketplaceAPI(async () => { throw new Error("private socket detail"); });
    await expect(offlineError.search({ text: "", hostIDs: [], page: 1, pageSize: 24, tab: "discover", category: "all" })).rejects.toBeInstanceOf(MarketplaceAPIError);
    try {
      await offlineError.search({ text: "", hostIDs: [], page: 1, pageSize: 24, tab: "discover", category: "all" });
    } catch (error) {
      expect(error).toEqual(expect.objectContaining({ endpoint: "catalog", status: undefined }));
      expect(String(error)).not.toContain("private socket detail");
    }
  });
});

describe("F04-C public view model and safe rendering boundary", () => {
  test("renders editorial discovery, ratings, local account/library states, and one card per result", async () => {
    const { hosts, page, detail } = await fixtureData();
    const catalogModel = toCatalogViewModel({ ...page, items: page.items.filter((item) => item.productID === "product.focus-field-guide"), total: 1 }, hosts);
    const productModel = toProductViewModel(detail, hosts);
    const catalogMarkup = renderCatalogState({ kind: "ready", route: { text: "focus", hostIDs: [], page: 1, pageSize: 24, tab: "discover", category: "all" }, model: catalogModel });
    const signedInMarkup = renderCatalogState({ kind: "ready", route: { text: "", hostIDs: [], page: 1, pageSize: 24, tab: "updates", category: "all" }, model: toCatalogViewModel(page, hosts) }, { accountState: "signed-in" });
    const productMarkup = renderProductState({ kind: "ready", route: { kind: "product", productID: detail.productID, returnHostIDs: [], returnText: "", detailTab: "overview" }, model: productModel });
    const serialized = JSON.stringify({ catalogModel, productModel, catalogMarkup, productMarkup });
    const viewModelSerialized = JSON.stringify({ catalogModel, productModel });
    expect(serialized).toContain("Focus Field Guide");
    expect(serialized).toContain("Field Guide Studio");
    expect(serialized).toContain("focus");
    expect(serialized).toContain("Next up");
    expect(serialized).toContain("NotchinTosh");
    expect(catalogMarkup).toContain("Our favourites");
    expect(catalogMarkup).toContain("Apps we love");
    expect(catalogMarkup).toContain("Get started");
    expect(catalogMarkup).toContain("Browse by category");
    expect(catalogMarkup).toContain("4.8");
    expect(catalogMarkup.match(/class=\"product-card\"/g)?.length).toBe(1);
    expect(catalogMarkup).toContain("data-marketplace-tab=\"discover\"");
    expect(catalogMarkup).toContain("Updates");
    expect(catalogMarkup).toContain("aria-label=\"8 updates\"");
    expect(catalogMarkup).toContain("Sign in to see your app library and updates.");
    expect(signedInMarkup).toContain("Volodymur Vasualkiw");
    expect(signedInMarkup).toContain("Installed apps");
    expect(signedInMarkup).toContain("Installed");
    expect(productMarkup).toContain("Overview");
    expect(productMarkup).toContain("Ratings &amp; Reviews");
    expect(productMarkup).toContain("What&#39;s New");
    expect(productMarkup).toContain("Privacy &amp; Permissions");
    expect(productMarkup).toContain("widget-showcase");
    expect(productMarkup.match(/class="widget-preview-card"/g)?.length).toBe(2);
    expect(productMarkup).toContain("detail-hero");
    expect(productMarkup).toContain("Server-rendered from the public catalog");
    expect(productMarkup.match(/class="detail-stats"/g)?.length).toBe(1);
    expect(productMarkup.match(/class="detail-stat"/g)?.length).toBe(6);
    expect(productMarkup.match(/class="widget-preview-card__caption"/g)?.length).toBe(2);
    expect(productMarkup).not.toContain("widget-preview-card__app");
    expect(productMarkup).toContain('src="/assets/widget-previews/widget.focus.next.svg"');
    expect(productMarkup).toContain('src="/assets/widget-previews/widget.focus.note.svg"');
    expect(productMarkup).not.toContain("What it brings to the host");
    expect(productMarkup).not.toContain("About this app");
    expect(productMarkup).not.toContain("What it includes");
    expect(productMarkup).not.toContain("component.focus.notch");
    expect(productMarkup).not.toContain("settingsSchema");
    expect(productMarkup).not.toContain("/private");
    expect(catalogMarkup).not.toContain("Field Guide Studio");
    expect(catalogMarkup).not.toContain("Public metadata only. No packages or installation handoff in the browser.");
    expect(catalogMarkup.match(/category-card--showcase/g)?.length).toBe(5);
    expect(productMarkup.match(/data-screenshot-slot=/g)?.length ?? 0).toBe(0);
    expect(productModel.components.flatMap((component) => component.widgets).map((widget) => widget.previewURL)).toContain("/assets/widget-previews/widget.focus.next.svg");
    expect(widgetPreviewURL("widget.focus/next")).toBe("/assets/widget-previews/widget.focus%2Fnext.svg");
    expect(catalogMarkup).not.toContain("host-picker__copy");
    expect(catalogMarkup).toContain('aria-label="Select NotchinTosh"');
    expect(catalogMarkup).toContain('aria-label="Select LaunchinTosh"');
    expect(serialized).toContain("1.2.0");
    expect(catalogMarkup).toContain("host-picker");
    expect(catalogMarkup).toContain('data-host-filter="notchintosh"');
    expect(catalogMarkup).not.toContain("<select");
    expect(catalogMarkup).toContain(">View</a>");
    expect(catalogMarkup).toContain(">Install</button>");
    expect(catalogMarkup).toContain("card-preview-grid");
    expect(catalogMarkup.match(/data-screenshot-slot=/g)?.length).toBe(4);
    expect(catalogMarkup).not.toContain("component.focus.notch");
    expect(catalogMarkup).not.toContain("component.focus.launch");
    expect(catalogMarkup).not.toContain("Current versions");
    expect(serialized).toContain("Clearer empty state");
    expect(serialized).toContain("Calendar events");
    expect(serialized).toContain("calendar metadata");
    expect(serialized).toContain("compact");
    expect(serialized).toContain("offline");
    expect(serialized).toContain("https://github.com/tosh-company/public-field-guide");
    expect(serialized).toContain("https://spdx.org/licenses/MIT.html");
    expect(serialized).toContain("https://field-guide.example/privacy");
    for (const forbidden of ["artifact", "objectKey", "digest", "signature", "publicKey", "/private/fixture", "settingsSchema", "actions", "portIDs", "reviewStatus", "submission", "runtimeData", "contactEmail", "deepLinkScheme"]) {
      expect(viewModelSerialized).not.toContain(forbidden);
      if (forbidden === "/private/fixture") expect(`${catalogMarkup}${productMarkup}`).not.toContain(forbidden);
    }
    expect(safePreviewURL({ path: "/private/fixture/previews/hero.png" })).toBeUndefined();
    expect(productModel.components[0]?.installable).toBe(false);
  });

  test("gates the rail library by account state and keeps preview actions non-mutating", async () => {
    const { hosts, page, detail } = await fixtureData();
    const route = { text: "focus mode", hostIDs: ["notchintosh"], page: 1, pageSize: 24, tab: "discover" as const, category: "all" as const };
    const catalogModel = toCatalogViewModel(page, hosts);
    const productModel = toProductViewModel(detail, hosts, "notchintosh");
    const signedOutCatalog = renderCatalogState({ kind: "ready", route, model: catalogModel });
    const signedOutProduct = renderProductState({
      kind: "ready",
      route: { kind: "product", productID: detail.productID, hostID: "notchintosh", returnHostIDs: ["notchintosh"], returnText: "focus mode", detailTab: "overview" },
      model: productModel,
    });
    const signedIn = renderCatalogState({ kind: "ready", route, model: catalogModel }, { accountState: "signed-in" });
    const actionNotice = renderCatalogState({ kind: "ready", route, model: catalogModel }, {
      accountState: "signed-in",
      previewAppNotice: {
        productID: INSTALLED_APPS[0]!.productID,
        action: "uninstall",
        message: "Uninstall preview only — no app was removed; the host app owns removal.",
      },
    });
    expect(signedOutCatalog).not.toContain('class="rail-library__row"');
    expect(signedOutProduct).not.toContain('class="rail-library__row"');
    expect(signedOutCatalog).toContain("Sign in to see your app library and updates.");
    expect(signedIn.match(/class="rail-library__row"/g)?.length).toBe(INSTALLED_APPS.length);
    expect(signedIn.match(/data-action="preview-app-manage"/g)?.length).toBe(INSTALLED_APPS.length);
    expect(signedIn.match(/data-action="preview-app-remove"/g)?.length).toBe(INSTALLED_APPS.length);
    expect(signedIn).toContain("Manage Focus Field Guide (preview)");
    expect(signedIn).toContain("Uninstall Weather Window (preview)");
    expect(signedIn).toContain("Volodymur Vasualkiw");
    expect(actionNotice).toContain('role="status"');
    expect(actionNotice).toContain("Uninstall preview only");
    expect(actionNotice.match(/class="rail-library__row"/g)?.length).toBe(INSTALLED_APPS.length);
    expect(signedIn).toContain(productURL(detail.productID, "notchintosh", route.text, route.hostIDs).replaceAll("&", "&amp;"));
    for (const forbidden of ["settingsSchema", "portIDs", "runtimeData", "packagePath", "deepLinkScheme"]) {
      expect(signedIn).not.toContain(forbidden);
      expect(actionNotice).not.toContain(forbidden);
    }
  });

  test("accepts only external metadata URLs and rejects active or filesystem schemes", () => {
    expect(safeExternalURL("https://example.test/source")).toBe("https://example.test/source");
    expect(safeExternalURL("http://example.test/support")).toBe("http://example.test/support");
    expect(safeExternalURL("javascript:alert(1)")).toBeUndefined();
    expect(safeExternalURL("data:text/html,private")).toBeUndefined();
    expect(safeExternalURL("file:///tmp/package.notchbridge")).toBeUndefined();
    expect(safeExternalURL("notchintosh://marketplace/product")).toBeUndefined();
  });

  test("escapes untrusted public text before it enters markup", async () => {
    const { hosts, page } = await fixtureData();
    const unsafePage = { ...page, items: page.items.map((item) => ({ ...item, name: "<script>alert(1)</script>", shortDescription: "\"quoted\" & unsafe" })) };
    const markup = renderCatalogState({ kind: "ready", route: { text: "", hostIDs: [], page: 1, pageSize: 24, tab: "discover", category: "all" }, model: toCatalogViewModel(unsafePage, hosts) });
    expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(markup).toContain("&quot;quoted&quot; &amp; unsafe");
    expect(markup).not.toContain("<script>alert(1)</script>");
  });
});

describe("F04-C serializable UI states and tabs", () => {
  test("renders loading without stale data and preserves catalog context through empty, error, offline, no-host, and category states", async () => {
    const { hosts, page } = await fixtureData();
    const model = toCatalogViewModel(page, hosts);
    const loading = renderCatalogState({ kind: "loading", route: catalogState });
    const empty = renderCatalogState({ kind: "empty", route: catalogState, model: { ...model, items: [], total: 0 } });
    const noHosts = renderCatalogState({ kind: "no-hosts", route: catalogState, model: { ...model, hosts: [], hostDataAvailable: false } });
    const apiError = renderCatalogState({ kind: "api-error", route: catalogState, endpoint: "catalog", message: "The public catalog could not be loaded. Retry to try again." });
    const offline = renderCatalogState({ kind: "offline", route: catalogState, message: "Public metadata is unavailable offline. Reconnect and retry." });
    const categoryEmpty = renderCatalogState({ kind: "ready", route: { ...catalogState, tab: "categories", category: "develop" }, model });
    expect(noHosts).not.toContain("Compatible with");
    expect(loading).toContain("skeleton-card");
    expect(loading).not.toContain("Focus Field Guide");
    expect(empty).toContain("No matching products");
    expect(empty).toContain("Reset category");
    expect(empty).toContain("Discover all apps");
    expect(empty).toContain("focus mode");
    expect(noHosts).toContain("Host compatibility needs attention");
    expect(noHosts).toContain("focus mode");
    expect(apiError).toContain("Retry");
    expect(apiError).toContain("focus mode");
    expect(offline).toContain("unavailable offline");
    expect(offline).toContain("focus mode");
    expect(categoryEmpty).toContain("Nothing in Develop yet");
    expect(categoryEmpty).toContain("Reset category");
    expect(categoryEmpty).toContain("Discover all apps");
  });

  test("renders all marketplace tabs with selected state and update/library surfaces", async () => {
    const { hosts, page } = await fixtureData();
    const model = toCatalogViewModel(page, hosts);
    for (const tab of ["discover", "work", "play", "create", "develop", "categories", "updates"] as const) {
      const markup = renderCatalogState({ kind: "ready", route: { text: "", hostIDs: [], page: 1, pageSize: 24, tab, category: "all" }, model });
      expect(markup).toContain(`data-active-tab="${tab}"`);
      expect(markup).toContain(`data-marketplace-tab="${tab}"`);
    }
    const work = renderCatalogState({ kind: "ready", route: { text: "", hostIDs: [], page: 1, pageSize: 24, tab: "work", category: "all" }, model });
    const develop = renderCatalogState({ kind: "ready", route: { text: "", hostIDs: [], page: 1, pageSize: 24, tab: "develop", category: "all" }, model });
    expect(work).toContain("Work apps");
    expect(develop).toContain("Nothing in Develop yet");
    const updates = renderCatalogState({ kind: "ready", route: { text: "", hostIDs: [], page: 1, pageSize: 24, tab: "updates", category: "all" }, model });
    expect(updates).toContain("Updates available");
    expect(updates).toContain("8 available");
    expect(updates.match(/class=\"update-row\"/g)?.length).toBe(8);
    expect(updates).toContain("Sign in to see your apps and updates");
  });

  test("renders product detail tabs, ratings, safe review gating, preview-only composer, updates, and permissions", async () => {
    const { hosts, detail } = await fixtureData();
    const model = toProductViewModel(detail, hosts);
    const baseRoute = { kind: "product" as const, productID: detail.productID, returnHostIDs: [], returnText: "", detailTab: "ratings" as const };
    const signedOut = renderProductState({ kind: "ready", route: baseRoute, model });
    const signedIn = renderProductState({ kind: "ready", route: baseRoute, model }, { accountState: "signed-in", reviewComposerOpen: true, reviewRating: 4, reviewText: "Preview copy" });
    const updates = renderProductState({ kind: "ready", route: { ...baseRoute, detailTab: "updates" }, model });
    const privacy = renderProductState({ kind: "ready", route: { ...baseRoute, detailTab: "privacy" }, model });
    expect(signedOut).toContain("4.8");
    expect(signedOut).toContain("rating-bar");
    expect(signedOut).toContain("Sign in to rate");
    expect(signedOut).toContain("Write a review");
    expect(signedIn).toContain("Preview composer");
    expect(signedIn).toContain("Preview only — this review will not persist or call an endpoint.");
    expect(signedIn).toContain("Preview copy");
    expect(updates).toContain("Current release");
    expect(updates).toContain("What's changed");
    expect(privacy).toContain("Privacy & permissions");
    expect(privacy).toContain("Calendar events");
  });

  test("renders unavailable detail, retry context, and selected-host incompatibility with preview install", async () => {
    const { fixture, hosts } = await fixtureData();
    const incompatible = await fixture.catalog.getProduct("product.weather-window", "notchintosh");
    if (!incompatible) throw new Error("Fixture incompatible product was not seeded.");
    const model = toProductViewModel(incompatible, hosts, "notchintosh");
    const route = { kind: "product" as const, productID: incompatible.productID, hostID: "notchintosh", returnHostIDs: ["notchintosh"], returnText: "weather", detailTab: "overview" as const };
    const ready = renderProductState({ kind: "ready", route, model });
    const notFound = renderProductState({ kind: "not-found", route });
    const apiError = renderProductState({ kind: "api-error", route, endpoint: "product", message: "This product could not be loaded right now." });
    const offline = renderProductState({ kind: "offline", route, message: "Public metadata is unavailable offline. Reconnect and retry." });
    expect(model.selectedHostCompatible).toBe(false);
    expect(ready).not.toContain("Unavailable for NotchinTosh");
    expect(ready).not.toContain("LaunchinTosh");
    expect(ready).not.toContain("https://tosh.example/launchintosh");
    expect(ready).toContain("widget-showcase");
    expect(ready).toContain("No widget previews are published yet.");
    expect(ready).toContain("Install");
    expect(ready).not.toContain("notchintosh://");
    expect(notFound).toContain("weather&amp;hostID=notchintosh");
    expect(apiError).toContain("Retry");
    expect(apiError).toContain("weather&amp;hostID=notchintosh");
    expect(offline).toContain("unavailable offline");
  });
});

describe("F04-C web handler and unchanged service boundary", () => {
  test("delegates v1 responses unchanged and serves shell/assets only on known browser paths", async () => {
    const assets: MarketplaceWebAssets = { html: "<html id=app></html>", script: "console.log('catalog')", styles: ".catalog{}" };
    const delegated: string[] = [];
    const handler = createMarketplaceWebHandler(async (request) => {
      delegated.push(request.url);
      return new Response("service response", { status: 218, headers: { "x-service": "unchanged", "content-type": "application/json" } });
    }, assets);
    const root = await handler(new Request("https://marketplace.test/"));
    const catalog = await handler(new Request("https://marketplace.test/catalog?q=focus"));
    const product = await handler(new Request("https://marketplace.test/products/product.focus-field-guide"));
    const css = await handler(new Request("https://marketplace.test/assets/catalog.css"));
    const script = await handler(new Request("https://marketplace.test/assets/catalog.js"));
    const api = await handler(new Request("https://marketplace.test/v1/catalog/products"));
    const unknown = await handler(new Request("https://marketplace.test/assets/other.js"));
    expect(await root.text()).toBe(assets.html);
    expect(await catalog.text()).toBe(assets.html);
    expect(await product.text()).toBe(assets.html);
    expect(await css.text()).toBe(assets.styles);
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(await script.text()).toBe(assets.script);
    expect(script.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(api.status).toBe(218);
    expect(api.headers.get("x-service")).toBe("unchanged");
    expect(await api.text()).toBe("service response");
    expect(unknown.status).toBe(404);
    expect(delegated).toEqual(["https://marketplace.test/v1/catalog/products"]);
  });

  test("serves public server-rendered widget previews and rejects private or invalid requests", async () => {
    const { fixture } = await fixtureData();
    const widget = await fixture.store.getWidget("widget.focus.next");
    if (!widget) throw new Error("Fixture widget was not seeded.");
    await fixture.store.saveWidget({ ...widget, description: "Escaped & <public> widget" });
    const handler = createMarketplaceWebHandler(async () => new Response("api"), { html: "", script: "", styles: "" }, createMarketplaceWidgetPreviewHandler(fixture.catalog));
    const get = await handler(new Request("https://marketplace.test/assets/widget-previews/widget.focus.next.svg"));
    const getBody = await get.text();
    const head = await handler(new Request("https://marketplace.test/assets/widget-previews/widget.focus.next.svg", { method: "HEAD" }));
    const unknown = await handler(new Request("https://marketplace.test/assets/widget-previews/widget.unknown.svg"));
    const malformed = await handler(new Request("https://marketplace.test/assets/widget-previews/widget%2Fprivate.svg"));
    const product = await fixture.store.getProduct("product.weather-window");
    if (!product) throw new Error("Fixture product was not seeded.");
    await fixture.store.saveProduct({ ...product, publicationStatus: "draft" });
    const unpublished = await handler(new Request("https://marketplace.test/assets/widget-previews/widget.weather.today.svg"));
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(get.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(getBody).toContain("Empty state");
    expect(getBody).toContain("Escaped &amp; &lt;public&gt; widget");
    expect(getBody).not.toContain("/private");
    expect(getBody).not.toContain("settingsSchema");
    expect(getBody).not.toContain("actions");
    expect(getBody).not.toContain("widget-preview.webp");
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(await head.text()).toBe("");
    expect(unknown.status).toBe(404);
    expect(malformed.status).toBe(404);
    expect(unpublished.status).toBe(404);
  });

  test("retains additive capabilities and the existing v1 envelope through the service handler", async () => {
    const { fixture } = await fixtureData();
    const handler = createMarketplaceHandler(fixture.catalog, fixture.publishing, fixture.authorizer);
    const catalogResponse = await handler(new Request("https://marketplace.test/v1/catalog/products?q=focus"));
    const catalogJSON = await catalogResponse.json() as { apiVersion: string; items: unknown[]; page: number; pageSize: number; total: number };
    expect(catalogJSON.apiVersion).toBe("v1");
    expect(Array.isArray(catalogJSON.items)).toBe(true);
    expect(catalogJSON.page).toBe(1);
    expect(catalogJSON.pageSize).toBe(24);
    expect(catalogJSON.total).toBe(1);
    const productResponse = await handler(new Request("https://marketplace.test/v1/products/product.focus-field-guide"));
    const productJSON = await productResponse.json() as { components: { capabilities?: unknown[] }[] };
    expect(productJSON.components[0]?.capabilities).toEqual([{ id: "calendar.read", title: "Calendar events", explanation: "Reads the next event title and time so the widget can show what is coming up.", risk: "medium", dataClasses: ["calendar metadata"] }]);
  });
});
