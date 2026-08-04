import type {
  CapabilityDeclaration,
  CatalogPage,
  CatalogProductDetail,
  CatalogProductSummary,
  Host,
  VersionRange,
  WidgetPreview,
} from "../domain";
import {
  EDITORIAL_PLACEMENTS,
  INSTALLED_APPS,
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_TABS,
  MARKETPLACE_UPDATES,
  categoryLabel,
  parseMarketplaceCategory,
  parseMarketplaceTab,
  productCategory,
  productPresentation,
  tabLabel,
  type MarketplaceAccountState,
  type MarketplaceCategory,
  type MarketplaceTab,
} from "./marketplace-presentation";

export type ProductDetailTab = "overview" | "ratings" | "updates" | "privacy";
export const PRODUCT_DETAIL_TABS: readonly ProductDetailTab[] = ["overview", "ratings", "updates", "privacy"];

export function parseProductDetailTab(hash: string): ProductDetailTab {
  const value = hash.replace(/^#/, "").trim().toLowerCase();
  return PRODUCT_DETAIL_TABS.includes(value as ProductDetailTab) ? (value as ProductDetailTab) : "overview";
}

export type CatalogURLState = {
  text: string;
  hostIDs: readonly string[];
  page: number;
  pageSize: number;
  tab?: MarketplaceTab;
  category?: MarketplaceCategory;
};

export type WebRoute =
  | { kind: "catalog"; state: CatalogURLState }
  | { kind: "product"; productID: string; hostID?: string; returnHostIDs: readonly string[]; returnText: string; detailTab?: ProductDetailTab }
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

function queryValues(url: URL, key: string): readonly string[] {
  return [...new Set(url.searchParams.getAll(key).map((value) => value.trim()).filter(Boolean))];
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
        hostIDs: queryValues(url, "hostID"),
        page: queryNumber(url, "page", DEFAULT_PAGE),
        pageSize: queryNumber(url, "pageSize", DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
        tab: parseMarketplaceTab(url.searchParams.get("tab")),
        category: parseMarketplaceCategory(url.searchParams.get("category")),
      },
    };
  }
  if (!pathname.startsWith("/products/")) return { kind: "not-found" };
  const encodedProductID = pathname.slice("/products/".length);
  if (!encodedProductID || encodedProductID.includes("/")) return { kind: "not-found" };
  const productID = decodePathSegment(encodedProductID);
  if (!productID) return { kind: "not-found" };
  const hostIDs = queryValues(url, "hostID");
  return {
    kind: "product",
    productID,
    hostID: hostIDs.length === 1 ? hostIDs[0] : undefined,
    returnHostIDs: hostIDs,
    returnText: url.searchParams.get("q") ?? "",
    detailTab: parseProductDetailTab(url.hash),
  };
}

export function catalogURL(state: CatalogURLState): string {
  const params = new URLSearchParams();
  const tab = parseMarketplaceTab(state.tab);
  const category = parseMarketplaceCategory(state.category);
  if (tab !== "discover") params.set("tab", tab);
  if (state.text) params.set("q", state.text);
  for (const hostID of state.hostIDs) {
    if (hostID) params.append("hostID", hostID);
  }
  if (category !== "all") params.set("category", category);
  const page = clampInteger(state.page, 1, undefined, DEFAULT_PAGE);
  const pageSize = clampInteger(state.pageSize, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  if (page !== DEFAULT_PAGE) params.set("page", String(page));
  if (pageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(pageSize));
  const query = params.toString();
  return `/catalog${query ? `?${query}` : ""}`;
}

export function productURL(productID: string, _hostID: string | undefined, returnText: string, returnHostIDs: readonly string[] = []): string {
  const params = new URLSearchParams();
  for (const selectedHostID of returnHostIDs) {
    if (selectedHostID) params.append("hostID", selectedHostID);
  }
  if (returnText) params.set("q", returnText);
  const query = params.toString();
  return `/products/${encodeURIComponent(productID)}${query ? `?${query}` : ""}`;
}

export function widgetPreviewURL(widgetID: string): string {
  return `/assets/widget-previews/${encodeURIComponent(widgetID)}.svg`;
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
      page: String(clampInteger(state.page, 1, undefined, DEFAULT_PAGE)),
      pageSize: String(clampInteger(state.pageSize, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE)),
    });
    for (const hostID of state.hostIDs) {
      if (hostID) params.append("hostID", hostID);
    }
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
  previewURL: string;

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
  const id = stringValue(record.id);

  const previews = Array.isArray(record.previewImages) ? record.previewImages.map((preview) => mapPreview(preview, `${name} preview`)) : [];
  return {
    id,
    name,
    icon: stringValue(record.icon, "widget"),
    description: stringValue(record.description),
    previewImages: previews,
    previewURL: widgetPreviewURL(id),
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

function renderIcon(name: MarketplaceTab): string {
  const paths: Readonly<Record<MarketplaceTab, string>> = {
    discover: "M12 3 20 9v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9l8-6Zm-3 9h6m-6 4h6",
    work: "M4 8h16v11H4V8Zm3 0V5h10v3M8 13h8",
    play: "m8 5 11 7-11 7V5Z",
    create: "m14 4 6 6-9 9H5v-6l9-9Zm-3 12 4 4",
    develop: "m14 4 6 6-4 4-6-6 4-4ZM4 20l6-6m-3 3 3 3",
    categories: "M4 5h6v6H4V5Zm10 0h6v6h-6V5ZM4 15h6v4H4v-4Zm10 0h6v4h-6v-4Z",
    updates: "M19 8a7 7 0 1 0 1 4m-1-4V4m0 4h-4",
  };
  return `<svg class="rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}" /></svg>`;
}

function renderAppLogo(value: string, size: "small" | "large" = "large"): string {
  const glyph = value.trim().slice(0, 2).toUpperCase() || "•";
  return `<span class="app-logo app-logo--${size}" aria-hidden="true">${escapeHTML(glyph)}</span>`;
}

function defaultCatalogState(text = "", hostIDs: readonly string[] = []): CatalogURLState {
  return { text, hostIDs, page: DEFAULT_PAGE, pageSize: DEFAULT_PAGE_SIZE, tab: "discover", category: "all" };
}

function catalogContext(route: WebRoute): CatalogURLState {
  if (route.kind === "catalog") return route.state;
  if (route.kind === "product") return defaultCatalogState(route.returnText, route.returnHostIDs);
  return defaultCatalogState();
}

function renderHostPicker(hosts: readonly HostViewModel[], selectedHostIDs: readonly string[], disabled: boolean): string {
  const options: readonly Pick<HostViewModel, "id" | "displayName" | "icon">[] = [{ id: "", displayName: "All apps", icon: "◎" }, ...hosts];
  return `<div class="host-picker" role="group" aria-label="Choose marketplace apps">${options.map((host) => {
    const selected = host.id ? selectedHostIDs.includes(host.id) : selectedHostIDs.length === 0;
    const filter = host.id || "all";
    const accessibleName = host.id ? `Select ${host.displayName}` : "Show products for all apps";
    return `<button class="host-picker__option${selected ? " host-picker__option--selected" : ""}" type="button" data-host-filter="${escapeHTML(filter)}" aria-label="${escapeHTML(accessibleName)}" aria-pressed="${selected}"${disabled ? " disabled" : ""}><span class="host-picker__logo">${renderAppLogo(host.icon, "small")}</span></button>`;
  }).join("")}</div>`;
}

function renderSearchField(route: CatalogURLState, id: string, label: string, compact = false): string {
  return `<div class="search-field${compact ? " search-field--compact" : ""}"><label for="${escapeHTML(id)}">${escapeHTML(label)}</label><input id="${escapeHTML(id)}" name="q" type="search" value="${escapeHTML(route.text)}" autocomplete="off" placeholder="Search products, widgets, or publishers" /><svg class="search-field__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 5 5" /></svg></div>`;
}

function navStateForTab(route: CatalogURLState, tab: MarketplaceTab): CatalogURLState {
  return {
    ...route,
    tab,
    category: tab === "categories" ? parseMarketplaceCategory(route.category) : "all",
    page: DEFAULT_PAGE,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}

function renderNavigation(route: WebRoute): string {
  const base = catalogContext(route);
  const activeTab = route.kind === "catalog" ? parseMarketplaceTab(route.state.tab) : "discover";
  return `<nav class="marketplace-rail__nav" aria-label="Marketplace sections"><p class="rail-section-label">Browse</p><ul>${MARKETPLACE_TABS.map((tab) => {
    const active = tab === activeTab;
    const href = catalogURL(navStateForTab(base, tab));
    const badge = tab === "updates" ? `<span class="rail-badge" aria-label="8 updates">8</span>` : "";
    return `<li><a class="rail-link${active ? " rail-link--selected" : ""}" href="${escapeHTML(href)}" data-app-route data-marketplace-tab="${escapeHTML(tab)}"${active ? ' aria-current="page"' : ""}>${renderIcon(tab)}<span>${escapeHTML(tabLabel(tab))}</span>${badge}</a></li>`;
  }).join("")}</ul></nav>`;
}

function renderRailLibrary(route: CatalogURLState, notice?: MarketplaceAppActionNotice): string {
  const detailHostID = route.hostIDs.length === 1 ? route.hostIDs[0] : undefined;
  return `<section class="rail-library" aria-labelledby="rail-library-title"><div class="rail-library__heading"><span class="rail-section-label" id="rail-library-title">Your apps</span><span class="rail-library__count">${escapeHTML(INSTALLED_APPS.length)}</span></div><div class="rail-library__viewport" aria-label="Installed app library">${INSTALLED_APPS.map((app) => {
    const label = labelForProduct(app.productID);
    const detailURL = productURL(app.productID, detailHostID, route.text, route.hostIDs);
    const activeNotice = notice?.productID === app.productID ? `<p class="rail-library__notice" role="status">${escapeHTML(notice.message)}</p>` : "";
    return `<article class="rail-library__row" data-library-product-id="${escapeHTML(app.productID)}"><div class="rail-library__identity">${renderAppLogo(label.icon, "small")}<div class="rail-library__copy"><a class="rail-library__open" href="${escapeHTML(detailURL)}" data-app-route><strong>${escapeHTML(label.name)}</strong><span>Installed v${escapeHTML(app.installedVersion)}</span></a>${app.updateAvailable ? `<span class="rail-library__update">Update available · v${escapeHTML(app.latestVersion)}</span>` : ""}</div></div><div class="rail-library__actions"><a class="rail-library__details" href="${escapeHTML(detailURL)}" data-app-route>Open</a><button class="rail-library__action rail-library__action--manage" type="button" data-action="preview-app-manage" data-product-id="${escapeHTML(app.productID)}" aria-label="Manage ${escapeHTML(label.name)} (preview)" title="Manage preview"><span aria-hidden="true">⋯</span></button><button class="rail-library__action rail-library__action--remove" type="button" data-action="preview-app-remove" data-product-id="${escapeHTML(app.productID)}" aria-label="Uninstall ${escapeHTML(label.name)} (preview)" title="Uninstall preview"><span aria-hidden="true">−</span></button></div>${activeNotice}</article>`;
  }).join("")}</div></section>`;
}

function renderRail(route: WebRoute, accountState: MarketplaceAccountState, notice?: MarketplaceAppActionNotice): string {
  const context = catalogContext(route);
  const library = accountState === "signed-in" ? renderRailLibrary(context, notice) : "";
  const footer = accountState === "signed-in" ? `<div class="rail-account rail-account--signed-in"><span class="rail-avatar" aria-hidden="true">VV</span><span class="rail-account__copy"><strong>Volodymur Vasualkiw</strong><small>Signed-in preview</small></span><button class="rail-account__button" type="button" data-action="toggle-account" aria-label="Sign out of preview account">Account</button></div>` : `<div class="rail-account rail-account--signed-out"><div><strong>Make it yours</strong><p>Sign in to see your app library and updates.</p></div><button class="button button--rail" type="button" data-action="toggle-account">Sign in</button></div>`;
  return `<aside class="marketplace-rail"><div class="marketplace-rail__header"><div class="rail-brand-row"><a class="rail-brand" href="/catalog" data-app-route><span class="rail-brand__mark" aria-hidden="true">T</span><span><strong>Tosh</strong><small>Marketplace</small></span></a><button class="rail-menu-button" type="button" data-action="toggle-menu" aria-expanded="false" aria-controls="marketplace-menu"><span class="sr-only">Open marketplace menu</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg></button></div><form class="rail-search" id="catalog-search" data-search-form>${renderSearchField(context, "catalog-query", "Search the marketplace", true)}<button type="submit" class="rail-search__submit" aria-label="Search marketplace"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m21 21-4.3-4.3m2.3-5.2a7.5 7.5 0 1 1-15 0Z" /></svg></button></form></div><div class="marketplace-rail__navigation" id="marketplace-menu" data-mobile-menu role="dialog" aria-modal="false" aria-label="Marketplace menu" aria-hidden="false"><div class="rail-navigation__links">${renderNavigation(route)}</div>${library}</div><footer class="marketplace-rail__footer">${footer}</footer></aside>`;
}
function renderEditorialPlacementLink(placement: (typeof EDITORIAL_PLACEMENTS)[number], route: CatalogURLState): string {
  const href = placement.productID ? productURL(placement.productID, route.hostIDs.length === 1 ? route.hostIDs[0] : undefined, route.text, route.hostIDs) : catalogURL({ ...route, tab: "categories", category: "all" });
  return `<a class="editorial-action" href="${escapeHTML(href)}" data-app-route>${escapeHTML(placement.actionLabel)}<span aria-hidden="true">↗</span></a>`;
}

function renderEditorialHero(route: CatalogURLState): string {
  const placement = EDITORIAL_PLACEMENTS[0]!;
  return `<section class="editorial-hero editorial-hero--${placement.tone}" aria-labelledby="hero-title"><div class="editorial-hero__texture" aria-hidden="true"><span class="hero-orbit hero-orbit--one"></span><span class="hero-orbit hero-orbit--two"></span><span class="hero-glyph">${renderAppLogo("focus", "large")}</span></div><div class="editorial-copy"><span class="eyebrow">${escapeHTML(placement.eyebrow)}</span><h2 id="hero-title">${escapeHTML(placement.title)}</h2><p>${escapeHTML(placement.body)}</p>${renderEditorialPlacementLink(placement, route)}</div></section>`;
}

function renderEditorialCard(placement: (typeof EDITORIAL_PLACEMENTS)[number], route: CatalogURLState): string {
  return `<article class="editorial-card editorial-card--${placement.tone}"><div class="editorial-card__mark" aria-hidden="true">${placement.productID ? renderAppLogo(placement.productID === "product.weather-window" ? "weather" : "focus", "small") : "✦"}</div><div><span class="eyebrow">${escapeHTML(placement.eyebrow)}</span><h3>${escapeHTML(placement.title)}</h3><p>${escapeHTML(placement.body)}</p>${renderEditorialPlacementLink(placement, route)}</div></article>`;
}

function categoryGlyph(category: MarketplaceCategory): string {
  switch (category) {
  case "all":
    return "✦";
  case "work":
    return "W";
  case "play":
    return "P";
  case "create":
    return "C";
  case "develop":
    return "D";
  }
}

function categoryDescription(category: MarketplaceCategory): string {
  switch (category) {
  case "all":
    return "The full collection, together.";
  case "work":
    return "Focus, planning, and daily rhythm.";
  case "play":
    return "Small moments of play and pause.";
  case "create":
    return "Tools for making things visible.";
  case "develop":
    return "Build, test, and tinker with intent.";
  }
}

function renderCategoryControls(route: CatalogURLState): string {
  const category = parseMarketplaceCategory(route.category);
  const cards = MARKETPLACE_CATEGORIES.map((value) => `<button class="category-card category-card--showcase category-card--${escapeHTML(value)}${value === category ? " category-card--selected" : ""}" type="button" data-category="${escapeHTML(value)}" aria-pressed="${value === category}"><span class="category-card__art" data-category-image="${escapeHTML(value)}" aria-hidden="true"><span class="category-card__glyph">${categoryGlyph(value)}</span></span><span class="category-card__content"><strong>${escapeHTML(categoryLabel(value))}</strong><span>${escapeHTML(categoryDescription(value))}</span></span><span class="category-card__arrow" aria-hidden="true">↗</span></button>`).join("");
  return `<section class="category-section category-showcase" aria-labelledby="category-title"><div class="section-heading"><div><h2 id="category-title">Browse by category</h2></div></div><div class="category-grid category-grid--showcase" role="group" aria-labelledby="category-title">${cards}</div></section>`;
}

function renderDiscoverSearch(route: CatalogURLState, model: CatalogViewModel): string {
  return `<section class="discover-search" aria-labelledby="search-title"><div class="section-heading"><div><h2 id="search-title">Find something that fits</h2></div></div><form id="discover-search" class="discover-search__form" data-search-form><div class="discover-search__query">${renderSearchField(route, "discover-query", "Search products, widgets, or publishers")}</div><div class="discover-search__hosts"><span class="field-label">Filter by host app</span>${renderHostPicker(model.hosts, route.hostIDs, !model.hostDataAvailable || model.hosts.length === 0)}</div><div class="discover-search__actions"><button class="button button--primary" type="submit">Search</button><button class="button button--quiet" type="button" data-action="reset">Reset</button></div></form></section>`;
}

function renderCardVersion(item: CatalogCardViewModel): string {
  const versions = [...new Set(Object.values(item.currentVersions).filter((version) => version.trim() !== ""))];
  return versions.length === 0 ? "Version pending" : `v${versions[0]}`;
}

function renderCardCompatibility(item: CatalogCardViewModel, route: CatalogURLState, hostDataAvailable: boolean): string {
  if (!hostDataAvailable) return `<span class="card-meta card-meta--warning"><span class="status-dot status-dot--warning" aria-hidden="true"></span>Compatibility pending</span>`;
  if (route.hostIDs.length > 0) {
    const compatibleCount = route.hostIDs.filter((hostID) => item.compatibleHostIDs.includes(hostID)).length;
    const selectedCount = route.hostIDs.length;
    const allCompatible = compatibleCount === selectedCount;
    const text = allCompatible ? "Compatible with selection" : compatibleCount > 0 ? `${compatibleCount} of ${selectedCount} selected hosts` : "Not available for selection";
    const status = allCompatible ? "success" : "warning";
    return `<span class="card-meta card-meta--${status}"><span class="status-dot status-dot--${status}" aria-hidden="true"></span>${escapeHTML(text)}</span>`;
  }
  const hostCount = item.compatibleHostIDs.length;
  return `<span class="card-meta card-meta--${hostCount > 0 ? "success" : "warning"}"><span class="status-dot status-dot--${hostCount > 0 ? "success" : "warning"}" aria-hidden="true"></span>${escapeHTML(hostCount > 0 ? `${hostCount} compatible host${hostCount === 1 ? "" : "s"}` : "Compatibility pending")}</span>`;
}

function renderRating(item: CatalogCardViewModel): string {
  const rating = productPresentation(item.productID).rating;
  return `<div class="rating-row" aria-label="${escapeHTML(`${rating.score} out of 5 stars from ${rating.reviewCount} reviews`)}"><span class="rating-stars" aria-hidden="true">★★★★★</span><strong>${escapeHTML(rating.score.toFixed(1))}</strong><span class="rating-count">(${escapeHTML(rating.reviewCount)})</span></div>`;
}

function renderCardScreenshotGallery(item: CatalogCardViewModel): string {
  const screenshots = productPresentation(item.productID).screenshots;
  return `<div class="card-preview-grid" role="group" aria-label="${escapeHTML(item.name)} screenshots">${screenshots.map((screenshot) => `<div class="card-preview-tile" role="img" data-screenshot-slot="${escapeHTML(screenshot.id)}" aria-label="${escapeHTML(`${item.name} ${screenshot.label}`)}"><span aria-hidden="true">⌁</span></div>`).join("")}</div>`;
}

function collectProductWidgets(model: ProductViewModel): readonly WidgetViewModel[] {
  const widgets: WidgetViewModel[] = [];
  const seenWidgetIDs = new Set<string>();
  for (const component of model.components) {
    for (const widget of component.widgets) {
      if (seenWidgetIDs.has(widget.id)) continue;
      seenWidgetIDs.add(widget.id);
      widgets.push(widget);
    }
  }
  return widgets;
}

function renderWidgetPreviewGallery(model: ProductViewModel): string {
  const widgets = collectProductWidgets(model);
  if (widgets.length === 0) {
    return `<section class="widget-showcase" aria-labelledby="widget-previews-title"><div class="widget-showcase__heading"><span class="eyebrow">Public widget gallery</span><h2 id="widget-previews-title">Widget previews</h2><p>No widget previews are published yet.</p></div></section>`;
  }
  const cards = widgets.map((widget) => {
    const hasEmptyState = widget.states.some((state) => state.trim().toLowerCase() === "empty");
    const previewKind = hasEmptyState ? "Empty state" : "Public preview";
    const sizes = [...new Set(widget.supportedSizes.map((size) => size.trim()).filter(Boolean))];
    const sizeMarkup = sizes.length > 0 ? `<div class="widget-preview-card__sizes" aria-label="Supported sizes">${sizes.map((size) => `<span class="widget-preview-card__size-chip">${escapeHTML(size)}</span>`).join("")}</div>` : "";
    return `<article class="widget-preview-card" role="listitem" tabindex="0" aria-label="${escapeHTML(`${widget.name} ${previewKind.toLowerCase()}`)}"><div class="widget-preview-card__caption"><div><span class="widget-preview-card__label">${escapeHTML(previewKind)}</span><h3>${escapeHTML(widget.name)}</h3></div><p>${escapeHTML(widget.description)}</p></div><div class="widget-preview-card__viewport"><img src="${escapeHTML(widget.previewURL)}" loading="lazy" alt="${escapeHTML(`${widget.name} ${previewKind.toLowerCase()}`)}"></div>${sizeMarkup}</article>`;
  }).join("");
  return `<section class="widget-showcase" aria-labelledby="widget-previews-title"><div class="widget-showcase__heading"><div><span class="eyebrow">Public widget gallery</span><h2 id="widget-previews-title">Preview every widget</h2></div><p>Server-rendered from the public catalog. No package code runs in the browser.</p></div><div class="widget-preview-gallery" role="list" aria-label="${escapeHTML(model.name)} widget previews">${cards}</div></section>`;
}



function renderProductInstallAction(item: CatalogCardViewModel, accountState: MarketplaceAccountState, previewNoticeProductID?: string): string {
  const noteID = `install-note-${item.productID.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const note = previewNoticeProductID === item.productID ? `<span id="${escapeHTML(noteID)}" class="card-handoff-note" role="status">Preview only — no installation or download was started.</span>` : "";
  const describedBy = note ? ` aria-describedby="${escapeHTML(noteID)}"` : "";
  const action = accountState === "signed-in" ? "preview-install" : "toggle-account";
  return `<div class="product-card__get"><button class="card-action card-action--secondary" type="button" data-action="${action}" data-product-id="${escapeHTML(item.productID)}"${describedBy}>Install</button>${note}</div>`;
}

function renderProductCard(item: CatalogCardViewModel, route: CatalogURLState, accountState: MarketplaceAccountState, previewNoticeProductID?: string): string {
  const detailHostID = route.hostIDs.length === 1 ? route.hostIDs[0] : undefined;
  return `<article class="product-card" data-product-id="${escapeHTML(item.productID)}"><div class="product-card__header"><div class="product-card__identity-row">${renderAppLogo(item.icon)}<div class="product-card__identity"><h3>${escapeHTML(item.name)}</h3></div></div></div><div class="product-card__description-row"><p>${escapeHTML(item.shortDescription)}</p>${renderRating(item)}</div><div class="product-card__actions"><a class="card-action card-action--primary" href="${escapeHTML(productURL(item.productID, detailHostID, route.text, route.hostIDs))}" data-app-route>View</a>${renderProductInstallAction(item, accountState, previewNoticeProductID)}</div>${renderCardScreenshotGallery(item)}</article>`;
}

function filterItems(items: readonly CatalogCardViewModel[], category: MarketplaceCategory): readonly CatalogCardViewModel[] {
  if (category === "all") return items;
  return items.filter((item) => productPresentation(item.productID).categories.includes(category));
}

function filterItemsForTab(items: readonly CatalogCardViewModel[], tab: MarketplaceTab): readonly CatalogCardViewModel[] {
  switch (tab) {
  case "work":
  case "play":
  case "create":
  case "develop":
    return filterItems(items, tab);
  case "discover":
  case "categories":
  case "updates":
    return items;
  }
}

function renderEmptyState(route: CatalogURLState, title = "No matching products", detail = "Try a broader search or choose another category. Public product metadata is the only source used here."): string {
  return `<section class="empty-state" aria-labelledby="empty-title"><div class="empty-state__mark" aria-hidden="true">∅</div><span class="eyebrow">Keep exploring</span><h2 id="empty-title">${escapeHTML(title)}</h2><p>${escapeHTML(detail)}</p><p class="empty-state__context">Current search: <strong>${escapeHTML(route.text || "All public products")}</strong></p><div class="empty-state__actions"><button class="button button--primary" type="button" data-action="reset-category">Reset category</button><button class="button button--quiet" type="button" data-action="reset">Discover all apps</button></div></section>`;
}

function renderProductResults(route: CatalogURLState, model: CatalogViewModel, heading: string, items: readonly CatalogCardViewModel[], accountState: MarketplaceAccountState, previewNoticeProductID: string | undefined, emptyTitle: string, emptyDetail: string): string {
  if (items.length === 0) return renderEmptyState(route, emptyTitle, emptyDetail);
  return `<section class="results-section" aria-labelledby="results-title"><div class="section-heading results-heading"><div><span class="eyebrow">${escapeHTML(heading)}</span><h2 id="results-title">${escapeHTML(String(items.length))} public app${items.length === 1 ? "" : "s"}</h2></div><p aria-live="polite">Page ${escapeHTML(String(model.page))} · ${escapeHTML(String(model.total))} total result${model.total === 1 ? "" : "s"}</p></div><div class="product-grid">${items.map((item) => renderProductCard(item, route, accountState, previewNoticeProductID)).join("")}</div></section>`;
}

function renderProductSection(route: CatalogURLState, model: CatalogViewModel, heading: string, category: MarketplaceCategory, accountState: MarketplaceAccountState, previewNoticeProductID?: string): string {
  const items = filterItems(model.items, category);
  return renderProductResults(
    route,
    model,
    heading,
    items,
    accountState,
    previewNoticeProductID,
    category === "all" ? "No matching products" : `Nothing in ${categoryLabel(category)} yet`,
    category === "all" ? "Try a broader search or choose another category. Public product metadata is the only source used here." : `There are no public catalog results in ${categoryLabel(category)} for this search.`,
  );
}

function renderProductTabSection(route: CatalogURLState, model: CatalogViewModel, tab: MarketplaceTab, accountState: MarketplaceAccountState, previewNoticeProductID?: string): string {
  const items = filterItemsForTab(model.items, tab);
  const label = tabLabel(tab);
  return renderProductResults(route, model, `${label} apps`, items, accountState, previewNoticeProductID, `Nothing in ${label} yet`, `There are no public catalog results in ${label} for this search.`);
}

function renderDiscover(route: CatalogURLState, model: CatalogViewModel, accountState: MarketplaceAccountState, previewNoticeProductID?: string): string {
  const supportPlacements = EDITORIAL_PLACEMENTS.slice(1);
  return `<div class="catalog-discover"><section class="page-intro"><span class="eyebrow">Tosh Marketplace</span><h1>Discover</h1></section>${renderEditorialHero(route)}<section class="editorial-support" aria-label="Marketplace recommendations">${supportPlacements.map((placement) => renderEditorialCard(placement, route)).join("")}</section>${renderCategoryControls(route)}${renderDiscoverSearch(route, model)}${renderProductSection(route, model, parseMarketplaceCategory(route.category) === "all" ? "Recommended for you" : `${categoryLabel(parseMarketplaceCategory(route.category))} picks`, parseMarketplaceCategory(route.category), accountState, previewNoticeProductID)}</div>`;
}

function renderTabSurface(route: CatalogURLState, model: CatalogViewModel, accountState: MarketplaceAccountState, previewNoticeProductID?: string): string {
  const tab = parseMarketplaceTab(route.tab);
  switch (tab) {
  case "discover":
    return renderDiscover(route, model, accountState, previewNoticeProductID);
  case "work":
  case "play":
  case "create":
  case "develop":
    return renderProductTabSection(route, model, tab, accountState, previewNoticeProductID);
  case "categories":
    return renderCategories(route, model, accountState, previewNoticeProductID);
  case "updates":
    return renderUpdates(route, model, accountState);
  }
}

function labelForProduct(productID: string): { name: string; icon: string } {
  if (productID === "product.focus-field-guide") return { name: "Focus Field Guide", icon: "focus" };
  if (productID === "product.weather-window") return { name: "Weather Window", icon: "weather" };
  return { name: "Public app", icon: "app" };
}

function renderUpdateRow(update: (typeof MARKETPLACE_UPDATES)[number], model: CatalogViewModel, route: CatalogURLState): string {
  const card = model.items.find((item) => item.productID === update.productID);
  const label = card ? { name: card.name, icon: card.icon } : labelForProduct(update.productID);
  const href = `${productURL(update.productID, route.hostIDs.length === 1 ? route.hostIDs[0] : undefined, route.text, route.hostIDs)}#updates`;
  return `<article class="update-row"><div class="update-row__identity">${renderAppLogo(label.icon, "small")}<div><h3>${escapeHTML(label.name)}</h3><p>${escapeHTML(update.releaseNote)}</p></div></div><div class="update-row__version"><strong>v${escapeHTML(update.version)}</strong><span>${escapeHTML(update.publishedLabel)}</span></div><a class="card-action card-action--quiet" href="${escapeHTML(href)}" data-app-route>Review update</a></article>`;
}

function renderInstalledRow(app: (typeof INSTALLED_APPS)[number], model: CatalogViewModel, route: CatalogURLState): string {
  const card = model.items.find((item) => item.productID === app.productID);
  const label = card ? { name: card.name, icon: card.icon } : labelForProduct(app.productID);
  const hostSummary = card && card.compatibleHostIDs.length > 0 ? `${card.compatibleHostIDs.length} compatible host${card.compatibleHostIDs.length === 1 ? "" : "s"}` : "Compatibility pending";
  return `<article class="installed-row"><div class="update-row__identity">${renderAppLogo(label.icon, "small")}<div><h3>${escapeHTML(label.name)}</h3><p>${escapeHTML(hostSummary)}</p></div></div><div class="installed-row__versions"><span>Installed <strong>v${escapeHTML(app.installedVersion)}</strong></span><span>Latest <strong>v${escapeHTML(app.latestVersion)}</strong></span></div><a class="card-action card-action--quiet" href="${escapeHTML(productURL(app.productID, route.hostIDs.length === 1 ? route.hostIDs[0] : undefined, route.text, route.hostIDs))}" data-app-route>Open details</a></article>`;
}

function renderUpdates(route: CatalogURLState, model: CatalogViewModel, accountState: MarketplaceAccountState): string {
  return `<div class="catalog-updates"><section class="page-intro"><span class="eyebrow">Your marketplace</span><div class="title-with-count"><h1>Updates</h1><span class="count-badge">${escapeHTML(MARKETPLACE_UPDATES.length)}</span></div><p>Review what is new in the public catalog. Updates here are presentation fixtures, not installation outcomes.</p></section><section class="updates-panel" aria-labelledby="updates-available-title"><div class="section-heading"><div><span class="eyebrow">${escapeHTML(MARKETPLACE_UPDATES.length)} available</span><h2 id="updates-available-title">Updates available</h2></div><p>Release notes stay public and readable.</p></div><div class="update-list">${MARKETPLACE_UPDATES.map((update) => renderUpdateRow(update, model, route)).join("")}</div></section><section class="updates-panel" aria-labelledby="installed-title"><div class="section-heading"><div><span class="eyebrow">Library</span><h2 id="installed-title">Installed apps</h2></div><p>Local preview of a signed-in library.</p></div>${accountState === "signed-in" ? `<div class="installed-list">${INSTALLED_APPS.map((app) => renderInstalledRow(app, model, route)).join("")}</div>` : `<div class="signed-out-library"><span class="signed-out-library__mark" aria-hidden="true">＋</span><div><h3>Sign in to see your apps and updates</h3><p>Public catalog results stay separate from your personal library.</p></div><button class="button button--primary" type="button" data-action="toggle-account">Sign in</button></div>`}</section></div>`;
}

function renderCategories(route: CatalogURLState, model: CatalogViewModel, accountState: MarketplaceAccountState, previewNoticeProductID?: string): string {
  const category = parseMarketplaceCategory(route.category);
  return `<div class="catalog-categories"><section class="page-intro"><span class="eyebrow">Browse the collection</span><h1>Categories</h1><p>Start with an intent, then move through the same public app catalog.</p></section>${renderCategoryControls(route)}${renderProductSection(route, model, category === "all" ? "All categories" : `${categoryLabel(category)} apps`, category, accountState, previewNoticeProductID)}</div>`;
}

function renderCatalogError(state: Extract<CatalogViewState, { kind: "api-error" | "offline" }>): string {
  const title = state.kind === "offline" ? "Public metadata is unavailable offline" : "The public catalog needs another try";
  return `<section class="message-state message-state--${state.kind}" role="alert" aria-live="assertive"><div class="message-state__mark" aria-hidden="true">${state.kind === "offline" ? "⌁" : "!"}</div><span class="eyebrow">${escapeHTML(state.route.text || "Marketplace")}</span><h2>${title}</h2><p>${escapeHTML(state.message)}</p><button class="button button--primary" type="button" data-action="retry">Retry</button></section>`;
}

export type MarketplaceAppPreviewAction = "manage" | "uninstall";

export interface MarketplaceAppActionNotice {
  productID: string;
  action: MarketplaceAppPreviewAction;
  message: string;
}

 
export interface MarketplaceRenderOptions {
  accountState?: MarketplaceAccountState;
  reviewComposerOpen?: boolean;
  reviewRating?: number;
  reviewText?: string;
  reviewSubmitted?: boolean;
  previewNoticeProductID?: string;
  previewAppNotice?: MarketplaceAppActionNotice;
}

function accountOption(options: MarketplaceRenderOptions): MarketplaceAccountState {
  return options.accountState ?? "signed-out";
}

export function renderCatalogState(state: CatalogViewState, options: MarketplaceRenderOptions = {}): string {
  const accountState = accountOption(options);
  const route = state.route;
  const rail = renderRail({ kind: "catalog", state: route }, accountState, options.previewAppNotice);
  if (state.kind === "loading") {
    return `<div class="marketplace-app">${rail}<div class="marketplace-workspace"><main class="marketplace-page catalog-page" data-state="loading"><div class="page-width"><div class="page-intro"><span class="eyebrow">Tosh Marketplace</span><h1>Discover</h1><p>Loading public apps and editorial picks.</p></div><div class="skeleton-editorial" aria-busy="true" aria-label="Loading marketplace"><span></span><span></span><span></span></div><div class="skeleton-grid" aria-hidden="true"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div></div></main></div></div>`;
  }
  const model = "model" in state ? state.model : { page: 1, pageSize: DEFAULT_PAGE_SIZE, total: 0, items: [], hosts: [], hostDataAvailable: false };
  const content = state.kind === "api-error" || state.kind === "offline" ? renderCatalogError(state) : renderTabSurface(route, model, accountState, options.previewNoticeProductID);
  const hostNotice = state.kind === "no-hosts" ? `<aside class="notice notice--warning" role="status"><strong>Host compatibility needs attention.</strong><span>No active host metadata is available, so products are shown without a universal compatibility claim.</span></aside>` : "";
  return `<div class="marketplace-app">${rail}<div class="marketplace-workspace"><main class="marketplace-page catalog-page" data-state="${escapeHTML(state.kind)}" data-active-tab="${escapeHTML(parseMarketplaceTab(route.tab))}"><div class="page-width">${hostNotice}${content}</div></main></div></div>`;
}



function renderCapability(capability: CapabilityViewModel): string {
  const dataClasses = capability.dataClasses.length > 0 ? `<span class="capability-data">Data: ${escapeHTML(capability.dataClasses.join(", "))}</span>` : "";
  return `<li class="capability-item"><div class="capability-item__top"><strong>${escapeHTML(capability.title)}</strong><span class="risk-chip risk-chip--${escapeHTML(capability.risk)}">${escapeHTML(capability.risk)} risk</span></div><p>${escapeHTML(capability.explanation)}</p>${dataClasses}</li>`;
}





function renderDetailTabs(route: Extract<WebRoute, { kind: "product" }>): string {
  const current = parseProductDetailTab(route.detailTab ? `#${route.detailTab}` : "#overview");
  const base = productURL(route.productID, route.hostID, route.returnText, route.returnHostIDs);
  const labels: Readonly<Record<ProductDetailTab, string>> = { overview: "Overview", ratings: "Ratings & Reviews", updates: "What's New", privacy: "Privacy & Permissions" };
  return `<nav class="detail-tabs" aria-label="Product details">${PRODUCT_DETAIL_TABS.map((tab) => `<a class="detail-tab${current === tab ? " detail-tab--selected" : ""}" href="${escapeHTML(`${base}#${tab}`)}" data-detail-tab="${escapeHTML(tab)}" aria-current="${current === tab ? "page" : "false"}">${escapeHTML(labels[tab])}</a>`).join("")}</nav>`;
}

function renderDetailStats(model: ProductViewModel): string {
  const presentation = productPresentation(model.productID);
  const rating = presentation.rating;
  const latestRelease = model.components.map((component) => component.release).sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }))[0];
  const widgets = collectProductWidgets(model);
  const category = productCategory(model.productID);
  const stats = [
    { label: "RATINGS", value: rating.score.toFixed(1), detail: `${rating.reviewCount} public ratings` },
    { label: "CATEGORY", value: categoryLabel(category as MarketplaceCategory), detail: model.tags.slice(0, 2).join(" · ") || "Public catalog" },
    { label: "DEVELOPER", value: model.publisherName, detail: "Public publisher" },
    { label: "WIDGETS", value: String(widgets.length), detail: "Published previews" },
    { label: "RELEASE", value: latestRelease?.version ? `v${latestRelease.version}` : "Pending", detail: latestRelease?.releaseNotes || "Public release" },
    { label: "HOSTS", value: String(model.compatibleHostIDs.length), detail: "Compatible hosts" },
  ];
  return `<section class="detail-stats" aria-label="Public app information">${stats.map((stat) => `<div class="detail-stat"><span class="detail-stat__label">${escapeHTML(stat.label)}</span><strong>${escapeHTML(stat.value)}</strong><span class="detail-stat__detail">${escapeHTML(stat.detail)}</span></div>`).join("")}</section>`;
}

function renderDetailHeader(model: ProductViewModel, route: Extract<WebRoute, { kind: "product" }>, accountState: MarketplaceAccountState, previewNoticeProductID?: string): string {
  const note = previewNoticeProductID === model.productID ? `<span class="detail-get-note" role="status">Preview only — no installation or download was started.</span>` : "";
  const action = accountState === "signed-in" ? "preview-install" : "toggle-account";
  return `<section class="detail-hero" aria-labelledby="product-title"><div class="detail-hero__identity">${renderAppLogo(model.icon, "large")}<div class="detail-hero__copy"><span class="detail-hero__eyebrow">Public marketplace app</span><h1 id="product-title">${escapeHTML(model.name)}</h1><p>${escapeHTML(model.shortDescription)}</p><span class="detail-hero__publisher">By ${escapeHTML(model.publisherName)}</span><div class="detail-hero__actions"><span class="detail-hero__availability">Public metadata</span><button class="detail-hero__share" type="button" data-action="share-product" data-product-id="${escapeHTML(model.productID)}" aria-label="Share ${escapeHTML(model.name)}">Share</button><button class="detail-hero__install" type="button" data-action="${action}" data-product-id="${escapeHTML(model.productID)}">Install</button>${note}</div></div></div></section>${renderDetailStats(model)}${renderDetailTabs(route)}`;
}

function renderOverview(model: ProductViewModel): string {
  return `<div class="detail-overview">${renderWidgetPreviewGallery(model)}</div>`;
}

function renderReviewComposer(options: MarketplaceRenderOptions): string {
  const open = options.reviewComposerOpen === true;
  const rating = Math.min(5, Math.max(1, Math.trunc(options.reviewRating ?? 5)));
  const text = options.reviewText ?? "";
  if (options.accountState !== "signed-in") {
    return `<div class="review-composer review-composer--${open ? "open" : "closed"}"><p>Sign in to rate. Your account state is only a local preview in this browser.</p><button class="button button--primary" type="button" data-action="toggle-account">Sign in to rate</button></div>`;
  }
  return `<form class="review-composer review-composer--${open ? "open" : "closed"}" id="review-composer" data-review-composer><div class="review-composer__heading"><div><span class="eyebrow">Preview composer</span><h3>Share a thought</h3></div><span class="preview-only-chip">Not saved</span></div><fieldset><legend>Choose a rating</legend><div class="review-stars">${[1, 2, 3, 4, 5].map((value) => `<button type="button" class="review-star${value <= rating ? " review-star--selected" : ""}" data-review-rating="${value}" aria-label="${value} star${value === 1 ? "" : "s"}" aria-pressed="${value === rating}">★</button>`).join("")}</div></fieldset><label for="review-text">Review text</label><textarea id="review-text" data-review-text rows="4" placeholder="What worked for you?">${escapeHTML(text)}</textarea><button class="button button--primary" type="submit" data-action="submit-review">Submit preview</button><p class="preview-only-note">Preview only — this review will not persist or call an endpoint.</p>${options.reviewSubmitted ? `<p class="review-submitted" role="status">Preview only — your review was not saved.</p>` : ""}</form>`;
}

function renderRatings(model: ProductViewModel, options: MarketplaceRenderOptions): string {
  const presentation = productPresentation(model.productID);
  const rating = presentation.rating;
  const stars = [5, 4, 3, 2, 1] as const;
  return `<div class="detail-ratings"><section class="rating-summary" aria-labelledby="rating-summary-title"><div class="rating-summary__score"><strong>${escapeHTML(rating.score.toFixed(1))}</strong><span class="rating-stars" aria-hidden="true">★★★★★</span><span>${escapeHTML(rating.reviewCount)} ratings</span></div><div class="rating-distribution" id="rating-summary-title">${stars.map((star) => `<div class="rating-bar"><span>${star}</span><div class="rating-bar__track"><span style="width:${Math.round((rating.distribution[star] / rating.reviewCount) * 100)}%"></span></div><span>${escapeHTML(rating.distribution[star])}</span></div>`).join("")}</div></section><section class="review-list" aria-labelledby="review-list-title"><div class="section-heading"><div><span class="eyebrow">Public excerpts</span><h2 id="review-list-title">What people notice</h2></div><button class="button button--quiet" type="button" data-action="review-toggle">Write a review</button></div><p class="review-gate">${options.accountState === "signed-in" ? "Signed-in preview enabled." : "Sign in to rate; reviews are not collected in this preview."}</p><div class="review-excerpts">${presentation.reviews.slice(0, 2).map((review) => `<article class="review-excerpt"><div class="review-excerpt__stars" aria-hidden="true">★★★★★</div><h3>${escapeHTML(review.title)}</h3><p>${escapeHTML(review.body)}</p><span>${escapeHTML(review.author)}</span></article>`).join("")}</div>${renderReviewComposer(options)}</section></div>`;
}

function renderWhatsNew(model: ProductViewModel): string {
  const rows = MARKETPLACE_UPDATES.filter((update) => update.productID === model.productID);
  const latest = model.components.map((component) => component.release).sort((a, b) => b.version.localeCompare(a.version))[0];
  return `<div class="detail-whats-new"><section class="release-highlight"><span class="eyebrow">Current release</span><h2>Version ${escapeHTML(latest?.version || rows[0]?.version || "pending")}</h2><p>${escapeHTML(latest?.releaseNotes || rows[0]?.releaseNote || "No release notes were published.")}</p></section><section class="release-list" aria-labelledby="release-list-title"><span class="eyebrow">Recent updates</span><h2 id="release-list-title">What's changed</h2>${rows.length > 0 ? `<ul>${rows.map((row) => `<li><div><strong>v${escapeHTML(row.version)}</strong><p>${escapeHTML(row.releaseNote)}</p></div><span>${escapeHTML(row.publishedLabel)}</span></li>`).join("")}</ul>` : `<p class="muted-copy">No local update rows are available for this product.</p>`}</section></div>`;
}

function renderPrivacy(model: ProductViewModel): string {
  const capabilities = model.components.flatMap((component) => component.capabilities);
  return `<div class="detail-privacy"><section class="privacy-intro"><span class="eyebrow">Privacy & permissions</span><h2>Declared access, plainly stated.</h2><p>These declarations come from the public catalog projection. No private runtime values or installation details are exposed here.</p></section><section class="privacy-capabilities" aria-labelledby="privacy-list-title"><h2 id="privacy-list-title">Permissions</h2>${capabilities.length > 0 ? `<ul class="capability-list">${capabilities.map(renderCapability).join("")}</ul>` : `<p class="muted-copy">No capability declarations were published.</p>`}</section></div>`;
}

function renderProductBody(model: ProductViewModel, route: Extract<WebRoute, { kind: "product" }>, options: MarketplaceRenderOptions): string {
  const tab = parseProductDetailTab(route.detailTab ? `#${route.detailTab}` : "#overview");
  const content = tab === "ratings" ? renderRatings(model, options) : tab === "updates" ? renderWhatsNew(model) : tab === "privacy" ? renderPrivacy(model) : renderOverview(model);
  return `<div class="detail-body" data-detail-tab-content="${escapeHTML(tab)}">${content}</div>`;
}

function renderProductError(state: Extract<ProductViewState, { kind: "api-error" | "offline" }>): string {
  const title = state.kind === "offline" ? "Public metadata is unavailable offline" : "This product needs another try";
  return `<section class="message-state message-state--${state.kind}" role="alert" aria-live="assertive"><div class="message-state__mark" aria-hidden="true">${state.kind === "offline" ? "⌁" : "!"}</div><span class="eyebrow">${escapeHTML(state.route.returnText || "Product")}</span><h2>${title}</h2><p>${escapeHTML(state.message)}</p><button class="button button--primary" type="button" data-action="retry">Retry</button></section>`;
}

export function renderProductState(state: ProductViewState, options: MarketplaceRenderOptions = {}): string {
  const accountState = accountOption(options);
  const route = state.route;
  const backURL = catalogURL(defaultCatalogState(route.returnText, route.returnHostIDs));
  const rail = renderRail(route, accountState, options.previewAppNotice);
  if (state.kind === "loading") {
    return `<div class="marketplace-app">${rail}<div class="marketplace-workspace"><main class="marketplace-page product-page" data-state="loading"><div class="page-width"><a class="back-link" href="${escapeHTML(backURL)}" data-app-route>← Back to catalog</a><div class="detail-skeleton" aria-busy="true" aria-label="Loading product"><div class="skeleton-detail-preview"></div><div class="skeleton-detail-copy"></div></div></div></main></div></div>`;
  }
  if (state.kind === "not-found") {
    return `<div class="marketplace-app">${rail}<div class="marketplace-workspace"><main class="marketplace-page product-page" data-state="not-found"><div class="page-width"><a class="back-link" href="${escapeHTML(backURL)}" data-app-route>← Back to catalog</a><section class="message-state"><div class="message-state__mark" aria-hidden="true">?</div><span class="eyebrow">Product</span><h1>Product unavailable</h1><p>This product is no longer available in the public catalog.</p><a class="button button--primary" href="${escapeHTML(backURL)}" data-app-route>Return to catalog</a></section></div></main></div></div>`;
  }
  if (state.kind === "api-error" || state.kind === "offline") {
    return `<div class="marketplace-app">${rail}<div class="marketplace-workspace"><main class="marketplace-page product-page" data-state="${escapeHTML(state.kind)}"><div class="page-width"><a class="back-link" href="${escapeHTML(backURL)}" data-app-route>← Back to catalog</a>${renderProductError(state)}</div></main></div></div>`;
  }
  const noHostsNotice = state.kind === "no-hosts" ? `<aside class="notice notice--warning" role="status"><strong>Host compatibility needs attention.</strong><span>Active host metadata is unavailable, so no universal compatibility claim is made.</span></aside>` : "";
  return `<div class="marketplace-app">${rail}<div class="marketplace-workspace"><main class="marketplace-page product-page" data-state="${escapeHTML(state.kind)}"><div class="page-width"><a class="back-link" href="${escapeHTML(backURL)}" data-app-route>← Back to catalog</a>${noHostsNotice}<div class="product-detail"><div class="product-detail__header">${renderDetailHeader(state.model, route, accountState, options.previewNoticeProductID)}</div>${renderProductBody(state.model, route, options)}</div></div></main></div></div>`;
}

function renderUnknownRoute(accountState: MarketplaceAccountState, notice?: MarketplaceAppActionNotice): string {
  const route: WebRoute = { kind: "catalog", state: defaultCatalogState() };
  return `<div class="marketplace-app">${renderRail(route, accountState, notice)}<div class="marketplace-workspace"><main class="marketplace-page product-page" data-state="not-found"><div class="page-width"><section class="message-state"><div class="message-state__mark" aria-hidden="true">?</div><span class="eyebrow">Marketplace</span><h1>Page not found</h1><p>This public marketplace route does not exist.</p><a class="button button--primary" href="/catalog" data-app-route>Return to catalog</a></section></div></main></div></div>`;
}

function isOfflineError(error: unknown): error is MarketplaceAPIError {
  return error instanceof MarketplaceAPIError && error.status === undefined;
}

function hasCatalogModel(state: CatalogViewState | ProductViewState): state is Extract<CatalogViewState, { model: CatalogViewModel }> {
  return "model" in state && !(("kind" in state.route) && state.route.kind === "product");
}

function hasProductModel(state: CatalogViewState | ProductViewState): state is Extract<ProductViewState, { model: ProductViewModel }> {
  return "model" in state && "kind" in state.route && state.route.kind === "product";
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
  let accountState: MarketplaceAccountState = "signed-out";
  let currentViewState: CatalogViewState | ProductViewState | undefined;
  let mobileMenuOpen = false;
  let previewNoticeProductID: string | undefined;
  let previewAppNotice: MarketplaceAppActionNotice | undefined;
  let reviewComposerOpen = false;
  let reviewRating = 5;
  let reviewText = "";
  let reviewSubmitted = false;

  const renderOptions = (): MarketplaceRenderOptions => ({ accountState, previewNoticeProductID, previewAppNotice, reviewComposerOpen, reviewRating, reviewText, reviewSubmitted });

  const syncMobileMenu = (): void => {
    const menu = root.querySelector<HTMLElement>("[data-mobile-menu]");
    const button = root.querySelector<HTMLButtonElement>("[data-action=toggle-menu]");
    if (!menu || !button) return;
    const isNarrow = typeof browserWindow.matchMedia === "function" && browserWindow.matchMedia("(max-width: 760px)").matches;
    if (!isNarrow) {
      menu.classList.remove("is-open");
      menu.setAttribute("aria-hidden", "false");
      menu.setAttribute("aria-modal", "false");
      menu.removeAttribute("inert");
      button.setAttribute("aria-expanded", "false");
      return;
    }
    menu.classList.toggle("is-open", mobileMenuOpen);
    menu.setAttribute("aria-hidden", String(!mobileMenuOpen));
    menu.setAttribute("aria-modal", "true");
    if (mobileMenuOpen) menu.removeAttribute("inert");
    else menu.setAttribute("inert", "");
    button.setAttribute("aria-expanded", String(mobileMenuOpen));
  };

  const setMobileMenuOpen = (open: boolean, returnFocus = false): void => {
    mobileMenuOpen = open;
    syncMobileMenu();
    if (open) root.querySelector<HTMLElement>("[data-mobile-menu] a")?.focus();
    else if (returnFocus) root.querySelector<HTMLButtonElement>("[data-action=toggle-menu]")?.focus();
  };

  const render = (state: CatalogViewState | ProductViewState): void => {
    if (disposed) return;
    currentViewState = state;
    const route = state.route;
    if ("kind" in route && route.kind === "product") {
      root.innerHTML = renderProductState(state as ProductViewState, renderOptions());
    } else {
      root.innerHTML = renderCatalogState(state as CatalogViewState, renderOptions());
    }
    syncMobileMenu();
  };

  const renderCurrent = (): void => {
    if (!currentViewState) return;
    render(currentViewState);
  };

  const load = async (): Promise<void> => {
    const token = ++requestID;
    const parsedRoute = parseRoute(new URL(browserWindow.location.href));
    if (parsedRoute.kind === "not-found") {
      currentViewState = undefined;
      if (!disposed) root.innerHTML = renderUnknownRoute(accountState, previewAppNotice);
      syncMobileMenu();
      return;
    }
    if (parsedRoute.kind === "catalog") {
      const route = parsedRoute.state;
      render({ kind: "loading", route });
      if (browserWindow.navigator.onLine === false) {
        render({ kind: "offline", route, message: "Public metadata is unavailable offline. Reconnect and retry." });
        return;
      }
      const [hostResult, catalogResult] = await Promise.allSettled([api.listHosts(), api.search(route)]);
      if (disposed || token !== requestID) return;
      if (catalogResult.status === "rejected") {
        if (isOfflineError(catalogResult.reason)) render({ kind: "offline", route, message: "Public metadata is unavailable offline. Reconnect and retry." });
        else if (catalogResult.reason instanceof MarketplaceAPIError) render({ kind: "api-error", route, endpoint: catalogResult.reason.endpoint, message: catalogResult.reason.message });
        else render({ kind: "api-error", route, endpoint: "catalog", message: "The public catalog could not be loaded. Retry to try again." });
        return;
      }
      if (hostResult.status === "rejected" && isOfflineError(hostResult.reason)) {
        render({ kind: "offline", route, message: "Public metadata is unavailable offline. Reconnect and retry." });
        return;
      }
      const hosts = hostResult.status === "fulfilled" ? hostResult.value : [];
      const model = toCatalogViewModel(catalogResult.value, hosts, hostResult.status === "fulfilled" && hosts.length > 0);
      if (model.hosts.length === 0) render({ kind: "no-hosts", route, model });
      else if (model.items.length === 0) render({ kind: "empty", route, model });
      else render({ kind: "ready", route, model });
      return;
    }
    const route = parsedRoute;
    render({ kind: "loading", route });
    if (browserWindow.navigator.onLine === false) {
      render({ kind: "offline", route, message: "Public metadata is unavailable offline. Reconnect and retry." });
      return;
    }
    const [hostResult, productResult] = await Promise.allSettled([api.listHosts(), api.getProduct(route.productID, route.hostID)]);
    if (disposed || token !== requestID) return;
    if (productResult.status === "rejected") {
      if (productResult.reason instanceof MarketplaceAPIError && productResult.reason.status === 404) render({ kind: "not-found", route });
      else if (isOfflineError(productResult.reason)) render({ kind: "offline", route, message: "Public metadata is unavailable offline. Reconnect and retry." });
      else if (productResult.reason instanceof MarketplaceAPIError) render({ kind: "api-error", route, endpoint: productResult.reason.endpoint, message: productResult.reason.message });
      else render({ kind: "api-error", route, endpoint: "product", message: "This product could not be loaded. Retry to try again." });
      return;
    }
    if (hostResult.status === "rejected" && isOfflineError(hostResult.reason)) {
      render({ kind: "offline", route, message: "Public metadata is unavailable offline. Reconnect and retry." });
      return;
    }
    const hosts = hostResult.status === "fulfilled" ? hostResult.value : [];
    const model = toProductViewModel(productResult.value, hosts, route.hostID, hostResult.status === "fulfilled" && hosts.length > 0);
    if (model.hosts.length === 0) render({ kind: "no-hosts", route, model });
    else render({ kind: "ready", route, model });
  };

  const navigate = (href: string): void => {
    const target = new URL(href, browserWindow.location.href);
    if (target.origin !== browserWindow.location.origin) return;
    browserWindow.history.pushState({}, "", `${target.pathname}${target.search}${target.hash}`);
    void load();
  };

  const updateCatalogLocally = (nextRoute: CatalogURLState): void => {
    if (!currentViewState || (currentViewState.kind !== "ready" && currentViewState.kind !== "empty" && currentViewState.kind !== "no-hosts") || ("kind" in currentViewState.route && currentViewState.route.kind === "product")) {
      navigate(catalogURL(nextRoute));
      return;
    }
    browserWindow.history.pushState({}, "", catalogURL(nextRoute));
    const modelState = currentViewState as Extract<CatalogViewState, { model: CatalogViewModel }>;
    if (modelState.model.hosts.length === 0) render({ kind: "no-hosts", route: nextRoute, model: modelState.model } as CatalogViewState);
    else if (modelState.model.items.length === 0) render({ kind: "empty", route: nextRoute, model: modelState.model } as CatalogViewState);
    else render({ kind: "ready", route: nextRoute, model: modelState.model } as CatalogViewState);
  };

  const updateProductTabLocally = (tab: ProductDetailTab): void => {
    const parsed = parseRoute(new URL(browserWindow.location.href));
    if (parsed.kind !== "product" || !currentViewState || (currentViewState.kind !== "ready" && currentViewState.kind !== "no-hosts")) return;
    const nextURL = `${browserWindow.location.pathname}${browserWindow.location.search}#${tab}`;
    browserWindow.history.pushState({}, "", nextURL);
    const productState = currentViewState as Extract<ProductViewState, { model: ProductViewModel }>;
    const route = { ...parsed, detailTab: tab };
    render({ ...productState, route } as ProductViewState);
  };

  const toggleAccount = (): void => {
    accountState = accountState === "signed-in" ? "signed-out" : "signed-in";
    previewAppNotice = undefined;
    renderCurrent();
  };

  const onClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const menu = target.closest<HTMLElement>("[data-mobile-menu]");
    if (menu && target === menu) {
      setMobileMenuOpen(false, true);
      return;
    }
    const hostFilter = target.closest<HTMLButtonElement>("[data-host-filter]")?.dataset.hostFilter;
    if (hostFilter !== undefined) {
      event.preventDefault();
      const route = parseRoute(new URL(browserWindow.location.href));
      if (route.kind !== "catalog") return;
      const selectedHostIDs = route.state.hostIDs;
      const nextHostIDs = hostFilter === "all" ? [] : selectedHostIDs.includes(hostFilter) ? selectedHostIDs.filter((hostID) => hostID !== hostFilter) : [...selectedHostIDs, hostFilter];
      navigate(catalogURL({ ...route.state, hostIDs: nextHostIDs, page: DEFAULT_PAGE, pageSize: DEFAULT_PAGE_SIZE }));
      return;
    }
    const category = target.closest<HTMLElement>("[data-category]")?.dataset.category;
    if (category !== undefined) {
      event.preventDefault();
      const route = parseRoute(new URL(browserWindow.location.href));
      if (route.kind !== "catalog") return;
      updateCatalogLocally({ ...route.state, category: parseMarketplaceCategory(category), page: DEFAULT_PAGE, pageSize: DEFAULT_PAGE_SIZE });
      return;
    }
    const detailTab = target.closest<HTMLElement>("[data-detail-tab]")?.dataset.detailTab;
    if (detailTab !== undefined) {
      event.preventDefault();
      updateProductTabLocally(parseProductDetailTab(`#${detailTab}`));
      return;
    }
    const marketplaceTab = target.closest<HTMLElement>("[data-marketplace-tab]")?.dataset.marketplaceTab;
    if (marketplaceTab !== undefined) {
      event.preventDefault();
      const route = parseRoute(new URL(browserWindow.location.href));
      const tab = parseMarketplaceTab(marketplaceTab);
      if (route.kind === "catalog") updateCatalogLocally(navStateForTab(route.state, tab));
      else navigate(catalogURL(navStateForTab(catalogContext(route), tab)));
      setMobileMenuOpen(false);
      return;
    }
    const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action === "toggle-menu") {
      event.preventDefault();
      setMobileMenuOpen(!mobileMenuOpen);
      return;
    }
    if (action === "toggle-account") {
      event.preventDefault();
      toggleAccount();
      return;
    }
    if (action === "preview-install") {
      event.preventDefault();
      previewNoticeProductID = target.closest<HTMLElement>("[data-product-id]")?.dataset.productId;
      renderCurrent();
      return;
    }
    if (action === "share-product") {
      event.preventDefault();
      const button = target.closest<HTMLButtonElement>("[data-action='share-product']");
      if (!button) return;
      const clipboardWrite = browserWindow.navigator.clipboard?.writeText(browserWindow.location.href);
      if (!clipboardWrite) return;
      void clipboardWrite.then(() => {
        button.textContent = "Copied";
        browserWindow.setTimeout(() => {
          if (button.isConnected) button.textContent = "Share";
        }, 1600);
      });
      return;
    }
    if (action === "preview-app-manage" || action === "preview-app-remove") {
      event.preventDefault();
      const productID = target.closest<HTMLElement>("[data-product-id]")?.dataset.productId;
      const app = INSTALLED_APPS.find((candidate) => candidate.productID === productID);
      if (!app || !productID) return;
      const label = labelForProduct(productID);
      const previewAction: MarketplaceAppPreviewAction = action === "preview-app-manage" ? "manage" : "uninstall";
      previewAppNotice = {
        productID,
        action: previewAction,
        message: previewAction === "manage"
          ? `Manage preview only — ${label.name} settings stay with the host app.`
          : `Uninstall preview only — no app was removed; the host app owns removal.`,
      };
      renderCurrent();
      return;
    }
    if (action === "review-toggle") {
      event.preventDefault();
      reviewComposerOpen = !reviewComposerOpen;
      reviewSubmitted = false;
      renderCurrent();
      return;
    }
    const reviewRatingValue = target.closest<HTMLElement>("[data-review-rating]")?.dataset.reviewRating;
    if (reviewRatingValue) {
      event.preventDefault();
      reviewRating = clampInteger(Number(reviewRatingValue), 1, 5, 5);
      reviewSubmitted = false;
      renderCurrent();
      return;
    }
    if (action === "reset-category") {
      event.preventDefault();
      const route = parseRoute(new URL(browserWindow.location.href));
      if (route.kind === "catalog") updateCatalogLocally({ ...route.state, category: "all", page: DEFAULT_PAGE, pageSize: DEFAULT_PAGE_SIZE });
      return;
    }
    if (action === "retry") {
      event.preventDefault();
      void load();
      return;
    }
    if (action === "reset") {
      event.preventDefault();
      navigate(catalogURL(defaultCatalogState()));
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
    if (form instanceof HTMLFormElement && form.id === "review-composer") {
      event.preventDefault();
      reviewSubmitted = true;
      reviewComposerOpen = true;
      renderCurrent();
      return;
    }
    if (!(form instanceof HTMLFormElement) || !form.matches("[data-search-form]")) return;
    event.preventDefault();
    const query = form.querySelector<HTMLInputElement>("input[name=q]")?.value ?? "";
    const route = parseRoute(new URL(browserWindow.location.href));
    const state = route.kind === "catalog" ? route.state : catalogContext(route);
    navigate(catalogURL({ ...state, text: query, tab: route.kind === "catalog" ? parseMarketplaceTab(state.tab) : "discover", category: route.kind === "catalog" ? parseMarketplaceCategory(state.category) : "all", page: DEFAULT_PAGE, pageSize: DEFAULT_PAGE_SIZE }));
  };

  const onInput = (event: Event): void => {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement && target.matches("[data-review-text]")) reviewText = target.value;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && mobileMenuOpen) {
      event.preventDefault();
      setMobileMenuOpen(false, true);
    }
  };

  const onPopState = (): void => {
    const parsed = parseRoute(new URL(browserWindow.location.href));
    if (parsed.kind === "product" && currentViewState && (currentViewState.kind === "ready" || currentViewState.kind === "no-hosts") && hasProductModel(currentViewState)) {
      const currentRoute = currentViewState.route;
      if (currentRoute.productID === parsed.productID && currentRoute.hostID === parsed.hostID && currentRoute.returnText === parsed.returnText && currentRoute.returnHostIDs.join("\u0000") === parsed.returnHostIDs.join("\u0000")) {
        const productState = currentViewState as Extract<ProductViewState, { model: ProductViewModel }>;
        render({ ...productState, route: parsed } as ProductViewState);
        return;
      }
    }
    if (parsed.kind === "catalog" && currentViewState && (currentViewState.kind === "ready" || currentViewState.kind === "empty" || currentViewState.kind === "no-hosts") && hasCatalogModel(currentViewState)) {
      const currentRoute = currentViewState.route;
      if (currentRoute.text === parsed.state.text && currentRoute.hostIDs.join("\u0000") === parsed.state.hostIDs.join("\u0000") && currentRoute.page === parsed.state.page && currentRoute.pageSize === parsed.state.pageSize) {
        render({ ...currentViewState, route: parsed.state } as CatalogViewState);
        return;
      }
    }
    void load();
  };

  const onResize = (): void => syncMobileMenu();

  root.addEventListener("click", onClick);
  root.addEventListener("submit", onSubmit);
  root.addEventListener("input", onInput);
  root.addEventListener("keydown", onKeyDown);
  browserWindow.addEventListener("popstate", onPopState);
  browserWindow.addEventListener("resize", onResize);
  void load();

  return {
    retry: load,
    dispose(): void {
      disposed = true;
      requestID += 1;
      root.removeEventListener("click", onClick);
      root.removeEventListener("submit", onSubmit);
      root.removeEventListener("input", onInput);
      root.removeEventListener("keydown", onKeyDown);
      browserWindow.removeEventListener("popstate", onPopState);
      browserWindow.removeEventListener("resize", onResize);
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
