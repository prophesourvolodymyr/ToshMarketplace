import { readFile } from "node:fs/promises";
import type { CatalogService } from "../catalog";
import { renderWidgetPreviewSVG } from "./widget-preview";
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

export function createMarketplaceWidgetPreviewHandler(catalog: CatalogService): (request: Request) => Promise<Response> {
  return async (request) => {
    const prefix = "/assets/widget-previews/";
    const pathname = new URL(request.url).pathname;
    const encodedFilename = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
    const encodedID = encodedFilename.endsWith(".svg") ? encodedFilename.slice(0, -4) : "";
    let widgetID: string | undefined;
    if (encodedID && !encodedID.includes("/")) {
      try {
        const decoded = decodeURIComponent(encodedID);
        if (decoded && !decoded.includes("/")) widgetID = decoded;
      } catch {
        widgetID = undefined;
      }
    }
    if (!widgetID || (request.method !== "GET" && request.method !== "HEAD")) return textResponse("Not found.", "text/plain; charset=utf-8", 404);
    const widget = await catalog.getPublicWidget(widgetID);
    if (!widget) return textResponse("Not found.", "text/plain; charset=utf-8", 404);
    const headers = {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    };
    return new Response(request.method === "HEAD" ? "" : renderWidgetPreviewSVG(widget), { status: 200, headers });
  };
}

export function createMarketplaceWebHandler(
  apiHandler: (request: Request) => Promise<Response>,
  assets: MarketplaceWebAssets,
  widgetPreviewHandler?: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/assets/widget-previews/")) {
      if (!widgetPreviewHandler) return textResponse("Not found.", "text/plain; charset=utf-8", 404);
      return widgetPreviewHandler(request);
    }
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
  return Bun.serve({ port, fetch: createMarketplaceWebHandler(apiHandler, assets, createMarketplaceWidgetPreviewHandler(catalog)) });
}

