import type {
  CapabilityDeclaration,
  CatalogPage,
  CatalogProductDetail,
  CatalogProductSummary,
  Host,
  HostCompatibility,
  ID,
  VersionRange,
  WidgetPreview,
} from "../domain";

export type CatalogURLState = {
  text: string;
  hostID?: string;
  page: number;
  pageSize: number;
};

export type WebRoute =
  | { kind: "catalog"; state: CatalogURLState }
  | { kind: "product"; productID: string; hostID?: string; returnText: string }
  | { kind: "not-found" };

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;

function clampInteger(value: number, minimum: number, maximum?: number, fallback = minimum): number {
  if (!Number.isFinite(value)) return fallback;
  const integer = Math.trunc(value);
  if (integer < minimum) return minimum;
  if (maximum !== undefined && integer > maximum) return maximum;
  return integer;
}

function queryNumber(url: URL, key: string, fallback: number, maximum?: number): number {
  const raw = url.searchParams.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return clampInteger(value, 1, maximum, fallback);
}

function optionalQueryValue(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  return value && value.trim() ? value : undefined;
}

function decodePathSegment(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value);
    return decoded || undefined;
  } catch {
    return undefined;
  }
}

export function parseRoute(url: URL): WebRoute {
  const pathname = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");
  if (pathname === "/" || pathname === "/catalog") {
    return {
      kind: "catalog",
      state: {
        text: url.searchParams.get("q") ?? "",
        hostID: optionalQueryValue(url, "hostID"),
        page: queryNumber(url, "page", DEFAULT_PAGE),
        pageSize: queryNumber(url, "pageSize", DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
      },
    };
  }
  if (!pathname.startsWith("/products/")) return { kind: "not-found" };
  const encodedProductID = pathname.slice("/products/".length);
  if (!encodedProductID || encodedProductID.includes("/")) return { kind: "not-found" };
  const productID = decodePathSegment(encodedProductID);
  if (!productID) return { kind: "not-found" };
  return {
    kind: "product",
    productID,
    hostID: optionalQueryValue(url, "hostID"),
    returnText: url.searchParams.get("q") ?? "",
  };
}

export function catalogURL(state: CatalogURLState): string {
  const params = new URLSearchParams();
  if (state.text) params.set("q", state.text);
  if (state.hostID) params.set("hostID", state.hostID);
  const page = clampInteger(state.page, 1, undefined, DEFAULT_PAGE);
  const pageSize = clampInteger(state.pageSize, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  if (page !== DEFAULT_PAGE) params.set("page", String(page));
  if (pageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(pageSize));
  const query = params.toString();
  return `/catalog${query ? `?${query}` : ""}`;
}

export function productURL(productID: string, hostID: string | undefined, returnText: string): string {
  const params = new URLSearchParams();
  if (hostID) params.set("hostID", hostID);
  if (returnText) params.set("q", returnText);
  const query = params.toString();
  return `/products/${encodeURIComponent(productID)}${query ? `?${query}` : ""}`;
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type APIEndpoint = "catalog" | "hosts" | "product";

function endpointMessage(endpoint: APIEndpoint, status?: number): string {
  if (endpoint === "product" && status === 404) return "This product is unavailable.";
  if (status === 404) return "This public marketplace route is unavailable.";
  if (status === 429) return "The public marketplace is busy. Retry in a moment.";
  if (endpoint === "catalog") return "The public catalog is temporarily unavailable.";
  if (endpoint === "hosts") return "Host compatibility information is temporarily unavailable.";
  return "This product could not be loaded right now.";
}

export class MarketplaceAPIError extends Error {
  public readonly endpoint: APIEndpoint;
  public readonly status: number | undefined;

  public constructor(endpoint: APIEndpoint, status?: number) {
    super(endpointMessage(endpoint, status));
    this.name = "MarketplaceAPIError";
    this.endpoint = endpoint;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCatalogPage(value: unknown): CatalogPage<CatalogProductSummary> {
  if (!isRecord(value) || value.apiVersion !== "v1" || !Array.isArray(value.items) || typeof value.page !== "number" || typeof value.pageSize !== "number" || typeof value.total !== "number") {
    throw new Error("Invalid catalog response.");
  }
  return value as unknown as CatalogPage<CatalogProductSummary>;
}

function parseHosts(value: unknown): readonly Host[] {
  if (!Array.isArray(value) || !value.every(isRecord)) throw new Error("Invalid host response.");
  return value as unknown as readonly Host[];
}

function parseProduct(value: unknown): CatalogProductDetail {
  if (!isRecord(value) || typeof value.productID !== "string" || !Array.isArray(value.components)) throw new Error("Invalid product response.");
  return value as unknown as CatalogProductDetail;
}

export interface MarketplaceAPIClient {
  search(state: CatalogURLState): Promise<CatalogPage<CatalogProductSummary>>;
  listHosts(): Promise<readonly Host[]>;
  getProduct(productID: string, hostID?: string): Promise<CatalogProductDetail>;
}

export class MarketplaceAPI implements MarketplaceAPIClient {
  private readonly fetcher: FetchLike;

  public constructor(fetcher: FetchLike = globalThis.fetch.bind(globalThis)) {
    this.fetcher = fetcher;
  }

  private async request<T>(endpoint: APIEndpoint, path: string, parse: (value: unknown) => T): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(path, { method: "GET", headers: { accept: "application/json" } });
    } catch {
      throw new MarketplaceAPIError(endpoint);
    }
    if (!response.ok) throw new MarketplaceAPIError(endpoint, response.status);
    try {
      return parse(await response.json());
    } catch {
      throw new MarketplaceAPIError(endpoint, response.status);
    }
  }

  public search(state: CatalogURLState): Promise<CatalogPage<CatalogProductSummary>> {
    const params = new URLSearchParams({
      q: state.text,
      hostID: state.hostID ?? "",
      page: String(clampInteger(state.page, 1, undefined, DEFAULT_PAGE)),
      pageSize: String(clampInteger(state.pageSize, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE)),
    });
    return this.request("catalog", `/v1/catalog/products?${params.toString()}`, parseCatalogPage);
  }

  public listHosts(): Promise<readonly Host[]> {
    return this.request("hosts", "/v1/hosts", parseHosts);
  }

  public getProduct(productID: string, hostID?: string): Promise<CatalogProductDetail> {
    const query = hostID ? `?${new URLSearchParams({ hostID }).toString()}` : "";
    return this.request("product", `/v1/products/${encodeURIComponent(productID)}${query}`, parseProduct);
  }
}

export interface HostViewModel {
  id: string;
  displayName: string;
  icon: string;
  packageFormat: string;
  lifecycle: Host["lifecycle"];
  sdkVersion: VersionRange;
  platformVersion: VersionRange;
  downloadURL?: string;
}

export interface CatalogCardViewModel {
  productID: string;
  publisherName: string;
  name: string;
  icon: string;
  shortDescription: string;
  tags: readonly string[];
  widgetCount: number;
  compatibleHostIDs: readonly string[];
  currentVersions: Readonly<Record<string, string>>;
}

export interface CatalogViewModel {
  page: number;
  pageSize: number;
  total: number;
  items: readonly CatalogCardViewModel[];
  hosts: readonly HostViewModel[];
  hostDataAvailable: boolean;
}

export interface PreviewViewModel {
  width: number;
  height: number;
  contentType: WidgetPreview["contentType"];
  label: string;
}

export interface CapabilityViewModel {
  id: string;
  title: string;
  explanation: string;
  risk: CapabilityDeclaration["risk"];
  dataClasses: readonly string[];
}

export interface WidgetViewModel {
  id: string;
  name: string;
  icon: string;
  description: string;
  previewImages: readonly PreviewViewModel[];
  supportedSizes: readonly string[];
  states: readonly string[];
}

export interface CompatibilityViewModel {
  hostID: string;
  packageFormat: string;
  hostVersion: VersionRange;
  sdkVersion: VersionRange;
  platformVersion: VersionRange;
}

export interface ProductComponentViewModel {
  id: string;
  hostID: string;
  packageFormat: string;
  bridgeID: string;
  releaseChannel: string;
  release: {
    id: string;
    version: string;
    releaseNotes: string;
    compatibility: CompatibilityViewModel;
  };
  capabilities: readonly CapabilityViewModel[];
  widgets: readonly WidgetViewModel[];
  installable: false;
}

export interface SafeLinkViewModel {
  label: string;
  href: string;
}

export interface ProductViewModel extends CatalogCardViewModel {
  publisherID: string;
  screenshots: readonly PreviewViewModel[];
  components: readonly ProductComponentViewModel[];
  links: readonly SafeLinkViewModel[];
  selectedHostID?: string;
  selectedHostName?: string;
  selectedHostKnown: boolean;
  selectedHostCompatible?: boolean;
  hosts: readonly HostViewModel[];
  alternativeHosts: readonly HostViewModel[];
  hostDataAvailable: boolean;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function mapVersionRange(value: unknown): VersionRange {
  const record = isRecord(value) ? value : {};
  const minimum = stringValue(record.minimum);
  const maximum = typeof record.maximum === "string" ? record.maximum : undefined;
  return maximum ? { minimum, maximum } : { minimum };
}

function mapHost(host: Host): HostViewModel {
  const record = host as unknown as Record<string, unknown>;
  const downloadURL = safeExternalURL(record.downloadURL);
  return {
    id: stringValue(record.id),
    displayName: stringValue(record.displayName, "Unnamed host"),
    icon: stringValue(record.icon, "host"),
    packageFormat: stringValue(record.packageFormat),
    lifecycle: record.lifecycle === "preview" || record.lifecycle === "deprecated" || record.lifecycle === "retired" ? record.lifecycle : "active",
    sdkVersion: mapVersionRange(record.sdkVersion),
    platformVersion: mapVersionRange(record.platformVersion),
    ...(downloadURL ? { downloadURL } : {}),
  };
}

function mapCapability(value: unknown): CapabilityViewModel {
  const record = isRecord(value) ? value : {};
  const risk = record.risk === "low" || record.risk === "medium" || record.risk === "high" || record.risk === "sensitive" ? record.risk : "none";
  return {
    id: stringValue(record.id),
    title: stringValue(record.title, "Declared capability"),
    explanation: stringValue(record.explanation),
    risk,
    dataClasses: stringList(record.dataClasses),
  };
}

function mapPreview(value: unknown, label: string): PreviewViewModel {
  const record = isRecord(value) ? value : {};
  const contentType = record.contentType === "image/jpeg" || record.contentType === "image/webp" ? record.contentType : "image/png";
  return {
    width: Math.max(1, numberValue(record.width, 1)),
    height: Math.max(1, numberValue(record.height, 1)),
    contentType,
    label,
  };
}

function mapWidget(value: unknown): WidgetViewModel {
  const record = isRecord(value) ? value : {};
  const name = stringValue(record.name, "Unnamed widget");
  const previews = Array.isArray(record.previewImages) ? record.previewImages.map((preview) => mapPreview(preview, `${name} preview`)) : [];
  return {
    id: stringValue(record.id),
    name,
    icon: stringValue(record.icon, "widget"),
    description: stringValue(record.description),
    previewImages: previews,
    supportedSizes: stringList(record.supportedSizes),
    states: stringList(record.states),
  };
}

function mapCompatibility(value: unknown): CompatibilityViewModel {
  const record = isRecord(value) ? value : {};
  return {
    hostID: stringValue(record.hostID),
    packageFormat: stringValue(record.packageFormat),
    hostVersion: mapVersionRange(record.hostVersion),
    sdkVersion: mapVersionRange(record.sdkVersion),
    platformVersion: mapVersionRange(record.platformVersion),
  };
}

function mapComponent(value: unknown): ProductComponentViewModel {
  const record = isRecord(value) ? value : {};
  const component = isRecord(record.component) ? record.component : {};
  const release = isRecord(record.release) ? record.release : {};
  const widgets = Array.isArray(record.widgets) ? record.widgets.map(mapWidget) : [];
  const capabilities = Array.isArray(record.capabilities) ? record.capabilities.map(mapCapability) : [];
  return {
    id: stringValue(component.id),
    hostID: stringValue(component.hostID),
    packageFormat: stringValue(component.packageFormat),
    bridgeID: stringValue(component.bridgeID),
    releaseChannel: stringValue(component.releaseChannel),
    release: {
      id: stringValue(release.id),
      version: stringValue(release.version),
      releaseNotes: stringValue(release.releaseNotes),
      compatibility: mapCompatibility(release.compatibility),
    },
    capabilities,
    widgets,
    installable: false,
  };
}

function copyVersions(value: unknown): Readonly<Record<string, string>> {
  const versions: Record<string, string> = Object.create(null) as Record<string, string>;
  if (!isRecord(value)) return versions;
  for (const [hostID, version] of Object.entries(value)) {
    if (typeof version === "string") versions[hostID] = version;
  }
  return versions;
}

function mapCard(value: CatalogProductSummary): CatalogCardViewModel {
  const record = value as unknown as Record<string, unknown>;
  return {
    productID: stringValue(record.productID),
    publisherName: stringValue(record.publisherName, "Unknown publisher"),
    name: stringValue(record.name, "Unnamed product"),
    icon: stringValue(record.icon, "product"),
    shortDescription: stringValue(record.shortDescription),
    tags: stringList(record.tags),
    widgetCount: Math.max(0, Math.trunc(numberValue(record.widgetCount))),
    compatibleHostIDs: stringList(record.compatibleHostIDs),
    currentVersions: copyVersions(record.currentVersions),
  };
}

export function safeExternalURL(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function safePreviewURL(_preview: Pick<WidgetPreview, "path"> | undefined): undefined {
  return undefined;
}

export function toHostViewModels(hosts: readonly Host[]): readonly HostViewModel[] {
  return hosts.map(mapHost).filter((host) => host.id);
}

export function toCatalogViewModel(page: CatalogPage<CatalogProductSummary>, hosts: readonly Host[], hostDataAvailable = hosts.length > 0): CatalogViewModel {
  return {
    page: page.page,
    pageSize: page.pageSize,
    total: page.total,
    items: page.items.map(mapCard),
    hosts: toHostViewModels(hosts),
    hostDataAvailable,
  };
}

export function toProductViewModel(detail: CatalogProductDetail, hosts: readonly Host[], selectedHostID?: string, hostDataAvailable = hosts.length > 0): ProductViewModel {
  const record = detail as unknown as Record<string, unknown>;
  const card = mapCard(detail);
  const hostModels = toHostViewModels(hosts);
  const selectedHost = selectedHostID ? hostModels.find((host) => host.id === selectedHostID) : undefined;
  const components = Array.isArray(record.components) ? record.components.map(mapComponent) : [];
  const compatibleHostIDs = card.compatibleHostIDs;
  const selectedHostCompatible = selectedHostID
    ? compatibleHostIDs.includes(selectedHostID) && components.some((component) => component.hostID === selectedHostID)
    : undefined;
  const links: SafeLinkViewModel[] = [];
  const sourceRepositoryURL = safeExternalURL(record.sourceRepositoryURL);
  const licenseURL = safeExternalURL(record.licenseURL);
  const supportURL = safeExternalURL(record.supportURL);
  const privacyPolicyURL = safeExternalURL(record.privacyPolicyURL);
  if (sourceRepositoryURL) links.push({ label: "Source repository", href: sourceRepositoryURL });
  if (licenseURL) links.push({ label: `${stringValue(record.licenseIdentifier, "License")} license`, href: licenseURL });
  if (supportURL) links.push({ label: "Support", href: supportURL });
  if (privacyPolicyURL) links.push({ label: "Privacy policy", href: privacyPolicyURL });
  const alternativeHosts = hostModels.filter((host) => compatibleHostIDs.includes(host.id) && host.id !== selectedHostID);
  return {
    ...card,
    publisherID: stringValue(record.publisherID),
    screenshots: Array.isArray(record.screenshots) ? record.screenshots.map((preview) => mapPreview(preview, `${card.name} screenshot`)) : [],
    components,
    links,
    ...(selectedHostID ? { selectedHostID } : {}),
    ...(selectedHost ? { selectedHostName: selectedHost.displayName } : {}),
    selectedHostKnown: Boolean(selectedHostID && selectedHost),
    ...(selectedHostID ? { selectedHostCompatible } : {}),
    hosts: hostModels,
    alternativeHosts,
    hostDataAvailable,
  };
}

export type CatalogViewState =
  | { kind: "loading"; route: CatalogURLState }
  | { kind: "ready"; route: CatalogURLState; model: CatalogViewModel }
  | { kind: "empty"; route: CatalogURLState; model: CatalogViewModel }
  | { kind: "no-hosts"; route: CatalogURLState; model: CatalogViewModel }
  | { kind: "api-error"; route: CatalogURLState; endpoint: APIEndpoint; message: string }
  | { kind: "offline"; route: CatalogURLState; message: string };

export type ProductViewState =
  | { kind: "loading"; route: Extract<WebRoute, { kind: "product" }> }
  | { kind: "ready"; route: Extract<WebRoute, { kind: "product" }>; model: ProductViewModel }
  | { kind: "no-hosts"; route: Extract<WebRoute, { kind: "product" }>; model: ProductViewModel }
  | { kind: "not-found"; route: Extract<WebRoute, { kind: "product" }> }
  | { kind: "api-error"; route: Extract<WebRoute, { kind: "product" }>; endpoint: APIEndpoint; message: string }
  | { kind: "offline"; route: Extract<WebRoute, { kind: "product" }>; message: string };

function escapeHTML(value: string | number | boolean): string {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function hostLabel(hosts: readonly HostViewModel[], hostID: string): string {
  return hosts.find((host) => host.id === hostID)?.displayName ?? hostID;
}

function renderAppLogo(value: string, size: "small" | "large" = "large"): string {
  const glyph = value.trim().slice(0, 2).toUpperCase() || "•";
  return `<span class="app-logo app-logo--${size}" aria-hidden="true">${escapeHTML(glyph)}</span>`;
}

function renderHostPicker(hosts: readonly HostViewModel[], selectedHostID: string | undefined, disabled: boolean): string {
  const options = [{ id: "", displayName: "All apps", icon: "all" }, ...hosts];
  return `<div class="host-picker" role="group" aria-label="Choose a host app">${options.map((host) => {
    const selected = host.id ? selectedHostID === host.id : !selectedHostID;
    const filter = host.id || "all";
    return `<button class="host-picker__option${selected ? " host-picker__option--selected" : ""}" type="button" data-host-filter="${escapeHTML(filter)}" aria-pressed="${selected}"${disabled ? " disabled" : ""}><span class="host-picker__logo">${renderAppLogo(host.icon, "small")}</span><span class="host-picker__copy"><strong>${escapeHTML(host.displayName)}</strong><span>${selected ? "Selected" : "View products"}</span></span></button>`;
  }).join("")}</div>`;
}

function renderHeader(): string {
  return `<header class="site-header"><div class="site-header__inner"><a class="wordmark" href="/catalog" data-app-route><span class="wordmark__mark" aria-hidden="true">T</span><span>Tosh Marketplace</span></a><p class="site-header__context">Public field guide · static metadata only</p></div></header>`;
}

function renderCatalogControls(route: CatalogURLState, model: CatalogViewModel): string {
  const hostHelp = model.hostDataAvailable ? "Choose a host app to filter its products." : "Host app choices are temporarily unavailable.";
  return `<section class="catalog-controls" aria-labelledby="catalog-controls-title"><div class="section-kicker">Discovery</div><h2 id="catalog-controls-title">Find a product for your setup</h2><form id="catalog-search" class="search-form"><div class="search-form__field search-form__field--query"><label for="catalog-query">Search products, widgets, or publishers</label><input id="catalog-query" name="q" type="search" value="${escapeHTML(route.text)}" autocomplete="off" placeholder="Try focus, weather, or a publisher" /></div><div class="search-form__field search-form__field--hosts"><span class="field-label" id="host-filter-label">Hosts</span>${renderHostPicker(model.hosts, route.hostID, !model.hostDataAvailable || model.hosts.length === 0)}<p id="host-filter-help" class="field-help">${escapeHTML(hostHelp)}</p></div><div class="search-form__actions"><button class="button button--primary" type="submit">Search</button><button class="button button--quiet" type="button" data-action="reset">Reset</button></div></form></section>`;
}

function renderCardPreviewGrid(item: CatalogCardViewModel): string {
  const previewMarks = ["✦", "◌", "⌁", "＋"];
  return `<div class="card-preview-grid" role="group" aria-label="${escapeHTML(item.name)} preview thumbnails">${previewMarks.map((mark, index) => `<div class="card-preview-tile" role="img" aria-label="${escapeHTML(`${item.name} preview ${index + 1}`)}"><span aria-hidden="true">${mark}</span><small>${escapeHTML(item.icon)}</small></div>`).join("")}</div>`;
}

function renderCardVersion(item: CatalogCardViewModel): string {
  const versions = [...new Set(Object.values(item.currentVersions).filter((version) => version.trim() !== ""))];
  const label = versions.length === 0 ? "Version pending" : versions.length === 1 ? `v${versions[0]}` : `${versions.length} current versions`;
  return `<span class="card-meta__version">${escapeHTML(label)}</span>`;
}

function renderCardCompatibility(item: CatalogCardViewModel, route: CatalogURLState, hosts: readonly HostViewModel[], hostDataAvailable: boolean): string {
  if (!hostDataAvailable) return `<span class="card-meta card-meta--warning"><span class="status-dot status-dot--warning" aria-hidden="true"></span>Compatibility pending</span>`;
  if (route.hostID) {
    const selectedHost = hostLabel(hosts, route.hostID);
    const compatible = item.compatibleHostIDs.includes(route.hostID);
    return `<span class="card-meta card-meta--${compatible ? "success" : "warning"}"><span class="status-dot status-dot--${compatible ? "success" : "warning"}" aria-hidden="true"></span>${escapeHTML(compatible ? `For ${selectedHost}` : `Not available for ${selectedHost}`)}</span>`;
  }
  const hostCount = item.compatibleHostIDs.length;
  return `<span class="card-meta card-meta--${hostCount > 0 ? "success" : "warning"}"><span class="status-dot status-dot--${hostCount > 0 ? "success" : "warning"}" aria-hidden="true"></span>${escapeHTML(hostCount > 0 ? `${hostCount} compatible host${hostCount === 1 ? "" : "s"}` : "Compatibility pending")}</span>`;
}

function renderProductCard(item: CatalogCardViewModel, route: CatalogURLState, hosts: readonly HostViewModel[], index: number, hostDataAvailable: boolean): string {
  const handoffID = `get-note-${item.productID.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return `<article class="product-card${index === 0 ? " product-card--featured" : ""}"><div class="product-card__body"><div class="product-card__top">${renderAppLogo(item.icon)}<div class="product-card__identity"><div class="product-card__eyebrow">${escapeHTML(item.publisherName)}</div><h3>${escapeHTML(item.name)}</h3><p class="product-card__description">${escapeHTML(item.shortDescription)}</p><div class="product-card__actions"><a class="card-action card-action--primary" href="${escapeHTML(productURL(item.productID, route.hostID, route.text))}" data-app-route>Check out</a><button class="card-action card-action--secondary" type="button" disabled aria-describedby="${escapeHTML(handoffID)}">Get</button></div><p class="card-handoff-note" id="${escapeHTML(handoffID)}">Host-app handoff is not available yet.</p></div></div>${renderCardPreviewGrid(item)}<footer class="product-card__footer"><span class="card-meta">${escapeHTML(String(item.widgetCount))} widget${item.widgetCount === 1 ? "" : "s"}</span>${renderCardCompatibility(item, route, hosts, hostDataAvailable)}${renderCardVersion(item)}</footer></div></article>`;
}

function renderCatalogResults(route: CatalogURLState, model: CatalogViewModel): string {
  if (model.items.length === 0) {
    return `<section class="empty-state" aria-labelledby="empty-title"><div class="empty-state__mark" aria-hidden="true">∅</div><h2 id="empty-title">No matching products</h2><p>Try a broader search or clear the host filter. Public product metadata is the only source used here.</p><div class="empty-state__actions"><button class="button button--primary" type="button" data-action="reset">Reset search and host</button></div></section>`;
  }
  const first = model.items[0];
  const featured = first ? `<section class="featured-band" aria-labelledby="featured-title"><div><div class="section-kicker">Featured in this search</div><h2 id="featured-title">${escapeHTML(first.name)}</h2><p>${escapeHTML(first.shortDescription)}</p></div><div class="featured-band__meta"><span>${escapeHTML(first.publisherName)}</span><span>${escapeHTML(String(first.widgetCount))} widgets</span><span>${escapeHTML(model.hostDataAvailable && first.compatibleHostIDs.length > 0 ? `${first.compatibleHostIDs.length} host${first.compatibleHostIDs.length === 1 ? "" : "s"}` : "Host data unavailable")}</span></div></section>` : "";
  return `${featured}<section class="results-section" aria-labelledby="results-title"><div class="results-heading"><div><div class="section-kicker">Public catalog</div><h2 id="results-title">${escapeHTML(String(model.total))} product${model.total === 1 ? "" : "s"}</h2></div><p aria-live="polite">Showing page ${escapeHTML(String(model.page))}</p></div><div class="product-grid">${model.items.map((item, index) => renderProductCard(item, route, model.hosts, index, model.hostDataAvailable)).join("")}</div></section>`;
}

function renderCatalogError(state: Extract<CatalogViewState, { kind: "api-error" | "offline" }>): string {
  const title = state.kind === "offline" ? "Public metadata is unavailable offline" : "The public catalog needs another try";
  return `<section class="message-state message-state--${state.kind}" role="alert" aria-live="assertive"><div class="message-state__mark" aria-hidden="true">${state.kind === "offline" ? "⌁" : "!"}</div><h2>${title}</h2><p>${escapeHTML(state.message)}</p><button class="button button--primary" type="button" data-action="retry">Retry</button></section>`;
}

export function renderCatalogState(state: CatalogViewState): string {
  if (state.kind === "loading") {
    return `${renderHeader()}<main class="catalog-page" data-state="loading"><div class="page-width"><section class="catalog-intro"><div class="section-kicker">Public catalog</div><h1>Find a widget that fits your day.</h1><p>Loading verified public metadata.</p></section><div class="skeleton-grid" aria-busy="true" aria-label="Loading catalog"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div></div></main>`;
  }
  const model = "model" in state ? state.model : { page: 1, pageSize: DEFAULT_PAGE_SIZE, total: 0, items: [], hosts: [], hostDataAvailable: false };
  const content = state.kind === "api-error" || state.kind === "offline" ? renderCatalogError(state) : renderCatalogResults(state.route, model);
  const hostNotice = state.kind === "no-hosts" ? `<aside class="notice notice--warning" role="status"><strong>Host compatibility needs attention.</strong><span>No active host metadata is available, so products are shown without a universal compatibility claim.</span></aside>` : "";
  return `${renderHeader()}<main class="catalog-page" data-state="${state.kind}"><div class="page-width">${renderCatalogControls(state.route, model)}${hostNotice}${content}</div></main>`;
}

function renderPreviewFallback(label: string, detail = "Preview unavailable in browser"): string {
  return `<div class="preview-fallback" role="img" aria-label="${escapeHTML(label)}"><span class="preview-fallback__glyph" aria-hidden="true">✦</span><span>${escapeHTML(detail)}</span></div>`;
}


function renderSafeLink(link: SafeLinkViewModel): string {
  return `<a class="metadata-link" href="${escapeHTML(link.href)}" target="_blank" rel="noreferrer">${escapeHTML(link.label)} <span aria-hidden="true">↗</span></a>`;
}

function renderCapability(capability: CapabilityViewModel): string {
  const dataClasses = capability.dataClasses.length > 0 ? `<span class="capability-data">Data: ${escapeHTML(capability.dataClasses.join(", "))}</span>` : "";
  return `<li class="capability-item"><div class="capability-item__top"><strong>${escapeHTML(capability.title)}</strong><span class="risk-chip risk-chip--${escapeHTML(capability.risk)}">${escapeHTML(capability.risk)} risk</span></div><p>${escapeHTML(capability.explanation)}</p>${dataClasses}</li>`;
}

function renderWidget(widget: WidgetViewModel): string {
  const sizes = widget.supportedSizes.length > 0 ? `<p><strong>Sizes:</strong> ${escapeHTML(widget.supportedSizes.join(", "))}</p>` : "";
  const states = widget.states.length > 0 ? `<p><strong>States:</strong> ${escapeHTML(widget.states.join(", "))}</p>` : "";
  const previews = widget.previewImages.length > 0 ? `<div class="widget-previews">${widget.previewImages.map((preview) => renderPreviewFallback(preview.label, "Static preview unavailable")).join("")}</div>` : "";
  return `<article class="widget-row"><div class="widget-row__icon" aria-hidden="true">${escapeHTML(widget.icon)}</div><div><h4>${escapeHTML(widget.name)}</h4><p>${escapeHTML(widget.description)}</p>${sizes}${states}${previews}</div></article>`;
}

function renderComponent(component: ProductComponentViewModel, hosts: readonly HostViewModel[]): string {
  const capabilities = component.capabilities.length > 0 ? `<ul class="capability-list">${component.capabilities.map(renderCapability).join("")}</ul>` : `<p class="muted-copy">No capability declarations were published for this component.</p>`;
  const widgets = component.widgets.length > 0 ? `<div class="widget-list">${component.widgets.map(renderWidget).join("")}</div>` : `<p class="muted-copy">No public widgets were published for this component.</p>`;
  return `<article class="component-section"><div class="component-heading"><div><div class="section-kicker">Host component</div><h3>${escapeHTML(hostLabel(hosts, component.hostID))}</h3></div><span class="status-chip status-chip--success">Compatible context</span></div><dl class="detail-list"><div><dt>Package format</dt><dd><code>${escapeHTML(component.packageFormat)}</code></dd></div><div><dt>Bridge</dt><dd><code>${escapeHTML(component.bridgeID)}</code></dd></div><div><dt>Release channel</dt><dd>${escapeHTML(component.releaseChannel)}</dd></div><div><dt>Current version</dt><dd><code>${escapeHTML(component.release.version)}</code></dd></div></dl><p class="handoff-note"><span class="status-dot status-dot--warning" aria-hidden="true"></span>Host-app handoff is not available in this public catalog.</p><section class="subsection"><h4>Permissions and data</h4>${capabilities}</section><section class="subsection"><h4>Widgets</h4>${widgets}</section><section class="subsection release-notes"><h4>Release notes</h4><p>${escapeHTML(component.release.releaseNotes)}</p></section></article>`;
}

function renderAlternativeHosts(model: ProductViewModel): string {
  if (model.alternativeHosts.length === 0) return "";
  return `<div class="alternative-hosts"><h3>Other compatible hosts</h3><ul>${model.alternativeHosts.map((host) => `<li><span class="host-chip"><span aria-hidden="true">${escapeHTML(host.icon)}</span>${escapeHTML(host.displayName)}</span>${host.downloadURL ? renderSafeLink({ label: `Get ${host.displayName}`, href: host.downloadURL }) : `<span class="muted-copy">Host download link unavailable</span>`}</li>`).join("")}</ul></div>`;
}

function renderCompatibility(model: ProductViewModel, hosts: readonly HostViewModel[]): string {
  if (!model.hostDataAvailable) {
    return `<section class="compatibility-panel compatibility-panel--warning" aria-labelledby="compatibility-title"><div class="section-kicker">Compatibility</div><h2 id="compatibility-title">Host context is unavailable</h2><p>We cannot confirm a universal host match until public host metadata is available. No installation or handoff action is offered.</p></section>`;
  }
  if (!model.selectedHostID) {
    return `<section class="compatibility-panel" aria-labelledby="compatibility-title"><div class="section-kicker">Compatibility</div><h2 id="compatibility-title">Available across ${escapeHTML(String(model.compatibleHostIDs.length))} host${model.compatibleHostIDs.length === 1 ? "" : "s"}</h2><p>Choose a host from the catalog to inspect its returned component context. Installation handoff is not available in this phase.</p><div class="host-chip-list">${model.compatibleHostIDs.map((hostID) => `<span class="host-chip"><span aria-hidden="true">${escapeHTML(hosts.find((host) => host.id === hostID)?.icon ?? "host")}</span>${escapeHTML(hostLabel(hosts, hostID))}</span>`).join("")}</div></section>`;
  }
  const selectedName = model.selectedHostName ?? model.selectedHostID;
  if (model.selectedHostCompatible) {
    return `<section class="compatibility-panel compatibility-panel--success" aria-labelledby="compatibility-title"><div class="section-kicker">Selected host</div><h2 id="compatibility-title">Compatible with ${escapeHTML(selectedName)}</h2><p>The public component matches this host. The host app still owns verification, permissions, and installation; no handoff action is available here.</p></section>`;
  }
  return `<section class="compatibility-panel compatibility-panel--warning" aria-labelledby="compatibility-title"><div class="section-kicker">Selected host</div><h2 id="compatibility-title">Unavailable for ${escapeHTML(selectedName)}</h2><p>No public component was returned for this host. This product is not presented as installable here.</p>${renderAlternativeHosts(model)}</section>`;
}

function renderProductBody(model: ProductViewModel): string {
  const previewLabel = `${model.name} preview`;
  const links = model.links.length > 0 ? `<section class="metadata-links" aria-labelledby="links-title"><h2 id="links-title">More from the publisher</h2><div>${model.links.map(renderSafeLink).join("")}</div></section>` : "";
  const components = model.components.length > 0 ? model.components.map((component) => renderComponent(component, model.hosts)).join("") : `<p class="muted-copy">No component is available for the selected host.</p>`;
  const tags = model.tags.length > 0 ? `<ul class="tag-list" aria-label="Tags">${model.tags.map((tag) => `<li>${escapeHTML(tag)}</li>`).join("")}</ul>` : "";
  return `<div class="detail-layout"><section class="detail-hero"><div class="detail-preview">${renderPreviewFallback(previewLabel)}</div><div class="detail-identity"><div class="section-kicker">Public product</div><h1>${escapeHTML(model.name)}</h1><p class="publisher-line">Published by <strong>${escapeHTML(model.publisherName)}</strong></p><p class="detail-description">${escapeHTML(model.shortDescription)}</p>${tags}<p class="detail-trust"><span class="status-dot status-dot--success" aria-hidden="true"></span>Published public metadata · ${escapeHTML(String(model.widgetCount))} widget${model.widgetCount === 1 ? "" : "s"}</p></div></section>${renderCompatibility(model, model.hosts)}<section class="detail-section" aria-labelledby="components-title"><div class="section-kicker">Host surfaces</div><h2 id="components-title">Components and widgets</h2><div class="component-list">${components}</div></section>${links}</div>`;
}

function renderProductError(state: Extract<ProductViewState, { kind: "api-error" | "offline" }>): string {
  const title = state.kind === "offline" ? "Public metadata is unavailable offline" : "This product needs another try";
  return `<section class="message-state message-state--${state.kind}" role="alert" aria-live="assertive"><div class="message-state__mark" aria-hidden="true">${state.kind === "offline" ? "⌁" : "!"}</div><h2>${title}</h2><p>${escapeHTML(state.message)}</p><button class="button button--primary" type="button" data-action="retry">Retry</button></section>`;
}

export function renderProductState(state: ProductViewState): string {
  const backURL = catalogURL({ text: state.route.returnText, hostID: state.route.hostID, page: DEFAULT_PAGE, pageSize: DEFAULT_PAGE_SIZE });
  if (state.kind === "loading") {
    return `${renderHeader()}<main class="product-page" data-state="loading"><div class="page-width"><a class="back-link" href="${escapeHTML(backURL)}" data-app-route>← Back to catalog</a><div class="detail-skeleton" aria-busy="true" aria-label="Loading product"><div class="skeleton-detail-preview"></div><div class="skeleton-detail-copy"></div></div></div></main>`;
  }
  if (state.kind === "not-found") {
    return `${renderHeader()}<main class="product-page" data-state="not-found"><div class="page-width"><a class="back-link" href="${escapeHTML(backURL)}" data-app-route>← Back to catalog</a><section class="message-state"><div class="message-state__mark" aria-hidden="true">?</div><h1>Product unavailable</h1><p>This product is no longer available in the public catalog.</p><a class="button button--primary" href="${escapeHTML(backURL)}" data-app-route>Return to catalog</a></section></div></main>`;
  }
  if (state.kind === "api-error" || state.kind === "offline") {
    return `${renderHeader()}<main class="product-page" data-state="${state.kind}"><div class="page-width"><a class="back-link" href="${escapeHTML(backURL)}" data-app-route>← Back to catalog</a>${renderProductError(state)}</div></main>`;
  }
  const noHostsNotice = state.kind === "no-hosts" ? `<aside class="notice notice--warning" role="status"><strong>Host compatibility needs attention.</strong><span>Active host metadata is unavailable, so no universal compatibility claim is made.</span></aside>` : "";
  return `${renderHeader()}<main class="product-page" data-state="${state.kind}"><div class="page-width"><a class="back-link" href="${escapeHTML(backURL)}" data-app-route>← Back to catalog</a>${noHostsNotice}${renderProductBody(state.model)}</div></main>`;
}

function renderUnknownRoute(): string {
  return `${renderHeader()}<main class="product-page" data-state="not-found"><div class="page-width"><section class="message-state"><div class="message-state__mark" aria-hidden="true">?</div><h1>Page not found</h1><p>This public marketplace route does not exist.</p><a class="button button--primary" href="/catalog" data-app-route>Return to catalog</a></section></div></main>`;
}

function isOfflineError(error: unknown): error is MarketplaceAPIError {
  return error instanceof MarketplaceAPIError && error.status === undefined;
}

export interface MarketplaceApp {
  retry(): Promise<void>;
  dispose(): void;
}

export interface MarketplaceAppOptions {
  fetcher?: FetchLike;
  window?: Window;
}

export function mountMarketplaceApp(root: HTMLElement, options: MarketplaceAppOptions = {}): MarketplaceApp {
  const browserWindow = options.window ?? globalThis.window;
  if (!browserWindow) throw new Error("A browser window is required to mount the marketplace app.");
  const api = new MarketplaceAPI(options.fetcher ?? browserWindow.fetch.bind(browserWindow));
  let disposed = false;
  let requestID = 0;
  let currentRoute: WebRoute = parseRoute(new URL(browserWindow.location.href));

  const render = (markup: string): void => {
    if (!disposed) root.innerHTML = markup;
  };

  const load = async (): Promise<void> => {
    const token = ++requestID;
    currentRoute = parseRoute(new URL(browserWindow.location.href));
    if (currentRoute.kind === "not-found") {
      render(renderUnknownRoute());
      return;
    }
    if (currentRoute.kind === "catalog") {
      const route = currentRoute.state;
      render(renderCatalogState({ kind: "loading", route }));
      if (browserWindow.navigator.onLine === false) {
        render(renderCatalogState({ kind: "offline", route, message: "Public metadata is unavailable offline. Reconnect and retry." }));
        return;
      }
      const [hostResult, catalogResult] = await Promise.allSettled([api.listHosts(), api.search(route)]);
      if (disposed || token !== requestID) return;
      if (catalogResult.status === "rejected") {
        if (isOfflineError(catalogResult.reason)) render(renderCatalogState({ kind: "offline", route, message: "Public metadata is unavailable offline. Reconnect and retry." }));
        else if (catalogResult.reason instanceof MarketplaceAPIError) render(renderCatalogState({ kind: "api-error", route, endpoint: catalogResult.reason.endpoint, message: catalogResult.reason.message }));
        else render(renderCatalogState({ kind: "api-error", route, endpoint: "catalog", message: "The public catalog could not be loaded. Retry to try again." }));
        return;
      }
      if (hostResult.status === "rejected" && isOfflineError(hostResult.reason)) {
        render(renderCatalogState({ kind: "offline", route, message: "Public metadata is unavailable offline. Reconnect and retry." }));
        return;
      }
      const hosts = hostResult.status === "fulfilled" ? hostResult.value : [];
      const model = toCatalogViewModel(catalogResult.value, hosts, hostResult.status === "fulfilled" && hosts.length > 0);
      const kind = model.hosts.length === 0 ? "no-hosts" : model.items.length === 0 ? "empty" : "ready";
      render(renderCatalogState({ kind, route, model }));
      return;
    }
    const route = currentRoute;
    render(renderProductState({ kind: "loading", route }));
    if (browserWindow.navigator.onLine === false) {
      render(renderProductState({ kind: "offline", route, message: "Public metadata is unavailable offline. Reconnect and retry." }));
      return;
    }
    const [hostResult, productResult] = await Promise.allSettled([api.listHosts(), api.getProduct(route.productID, route.hostID)]);
    if (disposed || token !== requestID) return;
    if (productResult.status === "rejected") {
      if (productResult.reason instanceof MarketplaceAPIError && productResult.reason.status === 404) {
        render(renderProductState({ kind: "not-found", route }));
      } else if (isOfflineError(productResult.reason)) {
        render(renderProductState({ kind: "offline", route, message: "Public metadata is unavailable offline. Reconnect and retry." }));
      } else if (productResult.reason instanceof MarketplaceAPIError) {
        render(renderProductState({ kind: "api-error", route, endpoint: productResult.reason.endpoint, message: productResult.reason.message }));
      } else {
        render(renderProductState({ kind: "api-error", route, endpoint: "product", message: "This product could not be loaded. Retry to try again." }));
      }
      return;
    }
    if (hostResult.status === "rejected" && isOfflineError(hostResult.reason)) {
      render(renderProductState({ kind: "offline", route, message: "Public metadata is unavailable offline. Reconnect and retry." }));
      return;
    }
    const hosts = hostResult.status === "fulfilled" ? hostResult.value : [];
    const model = toProductViewModel(productResult.value, hosts, route.hostID, hostResult.status === "fulfilled" && hosts.length > 0);
    render(renderProductState({ kind: model.hosts.length === 0 ? "no-hosts" : "ready", route, model }));
  };

  const navigate = (href: string): void => {
    const target = new URL(href, browserWindow.location.href);
    if (target.origin !== browserWindow.location.origin) return;
    browserWindow.history.pushState({}, "", `${target.pathname}${target.search}`);
    void load();
  };

  const onClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const hostFilter = target.closest<HTMLButtonElement>("[data-host-filter]")?.dataset.hostFilter;
    if (hostFilter !== undefined) {
      event.preventDefault();
      const route = parseRoute(new URL(browserWindow.location.href));
      if (route.kind !== "catalog") return;
      navigate(catalogURL({ text: route.state.text, hostID: hostFilter === "all" ? undefined : hostFilter, page: DEFAULT_PAGE, pageSize: DEFAULT_PAGE_SIZE }));
      return;
    }
    const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action === "retry") {
      event.preventDefault();
      void load();
      return;
    }
    if (action === "reset") {
      event.preventDefault();
      navigate(catalogURL({ text: "", page: DEFAULT_PAGE, pageSize: DEFAULT_PAGE_SIZE }));
      return;
    }
    const link = target.closest<HTMLAnchorElement>("a[data-app-route]");
    if (!link) return;
    const href = link.getAttribute("href");
    if (!href || link.target === "_blank") return;
    event.preventDefault();
    navigate(href);
  };

  const onSubmit = (event: SubmitEvent): void => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== "catalog-search") return;
    event.preventDefault();
    const query = form.querySelector<HTMLInputElement>("#catalog-query")?.value ?? "";
    const route = parseRoute(new URL(browserWindow.location.href));
    const hostID = route.kind === "catalog" ? route.state.hostID : undefined;
    navigate(catalogURL({ text: query, hostID, page: DEFAULT_PAGE, pageSize: DEFAULT_PAGE_SIZE }));
  };

  const onPopState = (): void => {
    void load();
  };

  root.addEventListener("click", onClick);
  root.addEventListener("submit", onSubmit);
  browserWindow.addEventListener("popstate", onPopState);
  void load();

  return {
    retry: load,
    dispose(): void {
      disposed = true;
      requestID += 1;
      root.removeEventListener("click", onClick);
      root.removeEventListener("submit", onSubmit);
      browserWindow.removeEventListener("popstate", onPopState);
    },
  };
}


function bootstrap(): void {
  const root = document.querySelector<HTMLElement>("#app");
  if (root) mountMarketplaceApp(root);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  else bootstrap();
}
