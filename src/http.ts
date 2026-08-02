import type { CatalogQuery, ID } from "./domain";
import { CatalogService } from "./catalog";
import type { MarketplaceStore, ArtifactStore, PackageFile } from "./storage";
import { PublishingService, SubmissionConflictError, SubmissionRateLimitError } from "./publishing";

export type MarketplaceAuthorizationDecision =
  | { authorized: true; actorID: ID; publisherID: ID }
  | { authorized: false; status: 401 | 403; message: string };

export interface MarketplaceAuthorizer {
  authorize(request: Request, publisherID: ID): Promise<MarketplaceAuthorizationDecision>;
}

export interface SubmissionJSONBody {
  productID: string;
  componentID: string;
  version: string;
  releaseNotes: string;
  files: readonly { path: string; base64: string }[];
}

const MAX_JSON_BYTES = 100 * 1024 * 1024;

class RequestBodyTooLargeError extends Error {
  public constructor() {
    super("Request body is too large.");
  }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": status === 200 ? "public, max-age=30" : "no-store",
      "x-tosh-marketplace-api": "v1",
    },
  });
}

function errorCode(status: number): string {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 413) return "request_too_large";
  if (status === 422) return "validation_failed";
  if (status === 429) return "rate_limited";
  return "request_failed";
}

function errorResponse(status: number, message: string): Response {
  return json({ error: { code: errorCode(status), message } }, status);
}

function decodeBase64(value: string): Uint8Array | undefined {
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return undefined;
  try {
    const decoded = atob(value);
    if (btoa(decoded) !== value) return undefined;
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

async function readJSON(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  const declaredLength = contentLength === null ? undefined : Number(contentLength);
  if (declaredLength !== undefined && Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) throw new RequestBodyTooLargeError();
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > MAX_JSON_BYTES) throw new RequestBodyTooLargeError();
      chunks.push(value);
      length += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Request body is not valid JSON.");
  }
}

function requestQuery(url: URL): CatalogQuery {
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "24");
  return {
    text: url.searchParams.get("q") ?? undefined,
    hostID: url.searchParams.get("hostID") ?? undefined,
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 24,
  };
}

function fileBody(body: unknown): { productID: string; componentID: string; version: string; releaseNotes: string; files: PackageFile[] } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error("Submission body must be an object.");
  const candidate = body as Partial<SubmissionJSONBody>;
  if (typeof candidate.productID !== "string" || typeof candidate.componentID !== "string" || typeof candidate.version !== "string" || typeof candidate.releaseNotes !== "string" || !Array.isArray(candidate.files)) {
    throw new Error("Submission requires productID, componentID, version, releaseNotes, and files.");
  }
  const files: PackageFile[] = [];
  for (const file of candidate.files) {
    if (typeof file !== "object" || file === null || typeof file.path !== "string" || typeof file.base64 !== "string") throw new Error("Every submission file requires path and base64.");
    const data = decodeBase64(file.base64);
    if (!data) throw new Error("Invalid base64 package file.");
    files.push({ path: file.path, data });
  }
  return { productID: candidate.productID, componentID: candidate.componentID, version: candidate.version, releaseNotes: candidate.releaseNotes, files };
}

function responseForError(error: unknown): Response {
  if (error instanceof RequestBodyTooLargeError) return errorResponse(413, error.message);
  if (error instanceof SubmissionConflictError) return errorResponse(409, error.message);
  if (error instanceof SubmissionRateLimitError) return errorResponse(429, error.message);
  const message = error instanceof Error ? error.message : "Marketplace request failed.";
  if (message === "Publisher account is not active." || message === "Developer Mode must be enabled for publishing." || message === "Publisher terms must be accepted before publishing.") {
    return errorResponse(403, message);
  }
  return errorResponse(400, message);
}

export function createMarketplaceHandler(
  catalog: CatalogService,
  publishing: PublishingService,
  authorizer: MarketplaceAuthorizer,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const url = new URL(request.url);
      const segments = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
      if (request.method === "GET" && segments[0] === "v1" && segments[1] === "catalog" && segments[2] === "products") return json(await catalog.search(requestQuery(url)));
      if (request.method === "GET" && segments[0] === "v1" && segments[1] === "products" && segments[2]) {
        const product = await catalog.getProduct(segments[2], url.searchParams.get("hostID") ?? undefined);
        return product ? json(product) : errorResponse(404, "Product not found.");
      }
      if (request.method === "GET" && segments[0] === "v1" && segments[1] === "hosts") return json(await catalog.listHosts());
      if (segments[0] !== "v1" || segments[1] !== "publishers" || !segments[2]) return errorResponse(404, "Route not found.");
      const decision = await authorizer.authorize(request, segments[2]);
      if (!decision.authorized) return errorResponse(decision.status, decision.message);
      if (request.method === "POST" && segments[3] === "submissions") {
        const body = fileBody(await readJSON(request));
        const result = await publishing.submit({ ...body, actorID: decision.actorID, publisherID: decision.publisherID });
        return json({ submission: result.submission, validation: result.validation }, result.submission.status === "rejected" ? 422 : 202);
      }
      return errorResponse(404, "Route not found.");
    } catch (error) {
      return responseForError(error);
    }
  };
}

export function createMarketplaceServer(
  catalog: CatalogService,
  publishing: PublishingService,
  authorizer: MarketplaceAuthorizer,
  port: number,
): ReturnType<typeof Bun.serve> {
  return Bun.serve({ port, fetch: createMarketplaceHandler(catalog, publishing, authorizer) });
}

export function createMarketplaceServices(store: MarketplaceStore, artifacts: ArtifactStore, reviewers: ConstructorParameters<typeof PublishingService>[2]) {
  return {
    catalog: new CatalogService(store),
    publishing: new PublishingService(store, artifacts, reviewers),
  };
}
