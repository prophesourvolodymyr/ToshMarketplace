import { describe, expect, test } from "bun:test";

import { createMarketplaceHandler } from "../http";
import { createMarketplaceWebFixture } from "./dev-fixture";
import {
  MarketplaceAPI,
  MarketplaceAPIError,
  catalogURL,
  parseRoute,
  productURL,
  renderCatalogState,
  renderProductState,
  safeExternalURL,
  safePreviewURL,
  toCatalogViewModel,
  toProductViewModel,
  type CatalogURLState,
} from "./catalog";
import { createMarketplaceWebHandler, type MarketplaceWebAssets } from "./server";

const catalogState: CatalogURLState = { text: "focus mode", hostID: "notchintosh", page: 2, pageSize: 48 };

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
  test("parses catalog, product, selected host, search, safe paging, and invalid routes", () => {
    expect(parseRoute(new URL("https://marketplace.test/")).kind).toBe("catalog");
    expect(parseRoute(new URL("https://marketplace.test/catalog?q=focus%20mode&hostID=notchintosh&page=0&pageSize=999"))).toEqual({
      kind: "catalog",
      state: { text: "focus mode", hostID: "notchintosh", page: 1, pageSize: 100 },
    });
    expect(parseRoute(new URL("https://marketplace.test/products/product.focus-field-guide?hostID=notchintosh&q=focus%20mode"))).toEqual({
      kind: "product",
      productID: "product.focus-field-guide",
      hostID: "notchintosh",
      returnText: "focus mode",
    });
    expect(parseRoute(new URL("https://marketplace.test/products/product%2Fwith-slash"))).toEqual({ kind: "product", productID: "product/with-slash", returnText: "" });
    expect(parseRoute(new URL("https://marketplace.test/publishers/private"))).toEqual({ kind: "not-found" });
    expect(parseRoute(new URL("https://marketplace.test/products/%E0%A4%A"))).toEqual({ kind: "not-found" });
    expect(catalogURL(catalogState)).toBe("/catalog?q=focus+mode&hostID=notchintosh&page=2&pageSize=48");
    expect(productURL("product.focus-field-guide", "notchintosh", "focus mode")).toBe("/products/product.focus-field-guide?hostID=notchintosh&q=focus+mode");
    expect(catalogURL({ text: "", page: 1, pageSize: 24 })).toBe("/catalog");
  });
});

describe("F04-C browser API client", () => {
  test("uses exact public API request URLs and preserves the v1 catalog envelope", async () => {
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
    const page = await api.search({ text: "focus", hostID: "notchintosh", page: 1, pageSize: 24 });
    await api.listHosts();
    await api.getProduct("product.focus-field-guide");
    await api.getProduct("product.focus-field-guide", "notchintosh");
    expect(requests).toEqual([
      "/v1/catalog/products?q=focus&hostID=notchintosh&page=1&pageSize=24",
      "/v1/hosts",
      "/v1/products/product.focus-field-guide",
      "/v1/products/product.focus-field-guide?hostID=notchintosh",
    ]);
    expect(page).toEqual({ apiVersion: "v1", items: [], page: 1, pageSize: 24, total: 0 });
  });

  test("sanitizes response and network errors without exposing API body details", async () => {
    const apiError = new MarketplaceAPI(async () => new Response(JSON.stringify({ error: { message: "private signing detail" } }), { status: 500 }));
    await expect(apiError.listHosts()).rejects.toEqual(expect.objectContaining({ endpoint: "hosts", status: 500, message: "Host compatibility information is temporarily unavailable." }));
    const offlineError = new MarketplaceAPI(async () => { throw new Error("private socket detail"); });
    await expect(offlineError.search({ text: "", page: 1, pageSize: 24 })).rejects.toBeInstanceOf(MarketplaceAPIError);
    try {
      await offlineError.search({ text: "", page: 1, pageSize: 24 });
    } catch (error) {
      expect(error).toEqual(expect.objectContaining({ endpoint: "catalog", status: undefined }));
      expect(String(error)).not.toContain("private socket detail");
    }
  });
});

describe("F04-C public view model and safe rendering boundary", () => {
  test("retains public product information and capabilities while dropping private and artifact metadata", async () => {
    const { hosts, page, detail } = await fixtureData();
    const catalogModel = toCatalogViewModel(page, hosts);
    const productModel = toProductViewModel(detail, hosts);
    const catalogMarkup = renderCatalogState({ kind: "ready", route: { text: "", page: 1, pageSize: 24 }, model: catalogModel });
    const productMarkup = renderProductState({ kind: "ready", route: { kind: "product", productID: detail.productID, returnText: "", }, model: productModel });
    const serialized = JSON.stringify({ catalogModel, productModel, catalogMarkup, productMarkup });
    const viewModelSerialized = JSON.stringify({ catalogModel, productModel });
    expect(serialized).toContain("Focus Field Guide");
    expect(serialized).toContain("Field Guide Studio");
    expect(serialized).toContain("focus");
    expect(serialized).toContain("Next up");
    expect(serialized).toContain("NotchinTosh");
    expect(serialized).toContain("1.2.0");
    expect(serialized).toContain("Adds a clearer empty state");
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
    const markup = renderCatalogState({ kind: "ready", route: { text: "", page: 1, pageSize: 24 }, model: toCatalogViewModel(unsafePage, hosts) });
    expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(markup).toContain("&quot;quoted&quot; &amp; unsafe");
    expect(markup).not.toContain("<script>alert(1)</script>");
  });
});

describe("F04-C serializable UI states", () => {
  test("renders loading without stale data and preserves catalog context through empty, error, offline, and no-host states", async () => {
    const { hosts, page } = await fixtureData();
    const model = toCatalogViewModel(page, hosts);
    const loading = renderCatalogState({ kind: "loading", route: catalogState });
    const empty = renderCatalogState({ kind: "empty", route: catalogState, model: { ...model, items: [], total: 0 } });
    const noHosts = renderCatalogState({ kind: "no-hosts", route: catalogState, model: { ...model, hosts: [], hostDataAvailable: false } });
    const apiError = renderCatalogState({ kind: "api-error", route: catalogState, endpoint: "catalog", message: "The public catalog could not be loaded. Retry to try again." });
    expect(noHosts).not.toContain("Compatible with");
    const offline = renderCatalogState({ kind: "offline", route: catalogState, message: "Public metadata is unavailable offline. Reconnect and retry." });
    expect(loading).toContain("skeleton-card");
    expect(loading).not.toContain("Focus Field Guide");
    expect(empty).toContain("No matching products");
    expect(empty).toContain("Reset search and host");
    expect(empty).toContain("focus mode");
    expect(noHosts).toContain("Host compatibility needs attention");
    expect(noHosts).toContain("focus mode");
    expect(apiError).toContain("Retry");
    expect(apiError).toContain("focus mode");
    expect(offline).toContain("unavailable offline");
    expect(offline).toContain("focus mode");
  });

  test("renders unavailable detail, retry context, and selected-host incompatibility without handoff CTAs", async () => {
    const { fixture, hosts } = await fixtureData();
    const incompatible = await fixture.catalog.getProduct("product.weather-window", "notchintosh");
    if (!incompatible) throw new Error("Fixture incompatible product was not seeded.");
    const model = toProductViewModel(incompatible, hosts, "notchintosh");
    const route = { kind: "product" as const, productID: incompatible.productID, hostID: "notchintosh", returnText: "weather" };
    const ready = renderProductState({ kind: "ready", route, model });
    const notFound = renderProductState({ kind: "not-found", route });
    const apiError = renderProductState({ kind: "api-error", route, endpoint: "product", message: "This product could not be loaded right now." });
    const offline = renderProductState({ kind: "offline", route, message: "Public metadata is unavailable offline. Reconnect and retry." });
    expect(model.selectedHostCompatible).toBe(false);
    expect(ready).toContain("Unavailable for NotchinTosh");
    expect(ready).toContain("LaunchinTosh");
    expect(ready).toContain("https://tosh.example/launchintosh");
    expect(ready).not.toContain("Install");
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
