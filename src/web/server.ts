import { readFile } from "node:fs/promises";
import type { CatalogService } from "../catalog";
import { createMarketplaceHandler, type MarketplaceAuthorizer } from "../http";
import type { PublishingService } from "../publishing";

export interface MarketplaceWebAssets {
  html: string;
  script: string;
  styles: string;
}
export interface MarketplaceWebServer {
  readonly url: URL;
  readonly port: number | undefined;
  stop(closeActiveConnections?: boolean): void;
}

let assetsPromise: Promise<MarketplaceWebAssets> | undefined;

async function buildBrowserScript(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [new URL("./catalog.ts", import.meta.url).pathname],
    target: "browser",
    format: "esm",
    minify: false,
  });
  if (!result.success) {
    const details = result.logs.map((log) => log.message).join(" ");
    throw new Error(`Unable to bundle marketplace browser code${details ? `: ${details}` : "."}`);
  }
  const output = result.outputs[0];
  if (!output) throw new Error("Marketplace browser bundle produced no output.");
  return output.text();
}

export async function loadMarketplaceWebAssets(): Promise<MarketplaceWebAssets> {
  if (!assetsPromise) {
    assetsPromise = Promise.all([
      readFile(new URL("./index.html", import.meta.url), "utf8"),
      buildBrowserScript(),
      readFile(new URL("./catalog.css", import.meta.url), "utf8"),
    ]).then(([html, script, styles]) => ({ html, script, styles }));
  }
  return assetsPromise;
}

function textResponse(body: string, contentType: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": contentType,
      "cache-control": status === 200 ? "no-cache" : "no-store",
    },
  });
}

function isProductShellPath(pathname: string): boolean {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return /^\/products\/[^/]+$/.test(normalized);
}

function isShellPath(pathname: string): boolean {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return normalized === "/" || normalized === "/catalog" || isProductShellPath(normalized);
}

export function createMarketplaceWebHandler(
  apiHandler: (request: Request) => Promise<Response>,
  assets: MarketplaceWebAssets,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/assets/catalog.css" && (request.method === "GET" || request.method === "HEAD")) {
      return request.method === "HEAD" ? textResponse("", "text/css; charset=utf-8") : textResponse(assets.styles, "text/css; charset=utf-8");
    }
    if (url.pathname === "/assets/catalog.js" && (request.method === "GET" || request.method === "HEAD")) {
      return request.method === "HEAD" ? textResponse("", "text/javascript; charset=utf-8") : textResponse(assets.script, "text/javascript; charset=utf-8");
    }
    if (url.pathname === "/v1" || url.pathname.startsWith("/v1/")) return apiHandler(request);
    if (request.method === "GET" && isShellPath(url.pathname)) return textResponse(assets.html, "text/html; charset=utf-8");
    return textResponse("Not found.", "text/plain; charset=utf-8", 404);
  };
}

export async function createMarketplaceWebServer(
  catalog: CatalogService,
  publishing: PublishingService,
  authorizer: MarketplaceAuthorizer,
  port: number,
): Promise<MarketplaceWebServer> {
  const assets = await loadMarketplaceWebAssets();
  const apiHandler = createMarketplaceHandler(catalog, publishing, authorizer);
  return Bun.serve({ port, fetch: createMarketplaceWebHandler(apiHandler, assets) });
}

