import {
  assertPublicMetadataSafe,
  compareSemver,
  isInstallableRelease,
  type CatalogComponent,
  type CatalogPage,
  type CatalogProductDetail,
  type CatalogProductSummary,
  type CatalogQuery,
  type HostComponent,
  type ID,
  type Product,
  type Publisher,
  type Release,
  type Widget,
} from "./domain";
import type { MarketplaceStore } from "./storage";

interface PublicComponentContext {
  component: HostComponent;
  release: Release;
  widgets: readonly Widget[];
  publisher: Publisher;
  product: Product;
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function scoreSearch(query: string, values: readonly string[]): number {
  const tokens = normalized(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  const text = values.map(normalized).join(" ");
  let score = 0;
  for (const token of tokens) {
    if (text === token) score += 100;
    else if (values.some((value) => normalized(value).startsWith(token))) score += 60;
    else if (text.includes(token)) score += 20;
    else return -1;
  }
  return score;
}

function currentPublicRelease(component: HostComponent, releases: readonly Release[]): Release | undefined {
  const candidates = releases
    .filter((release) => release.componentID === component.id && isInstallableRelease(release))
    .sort((left, right) => (right.publishedAt ?? "").localeCompare(left.publishedAt ?? "") || compareSemver(right.version, left.version));
  if (component.currentReleaseID) {
    const current = candidates.find((release) => release.id === component.currentReleaseID);
    if (current) return current;
  }
  return candidates[0];
}

function publicComponent(context: PublicComponentContext, installable: boolean, unavailableReason?: string): CatalogComponent {
  const { component, release, widgets } = context;
  const result: CatalogComponent = {
    component: {
      id: component.id,
      hostID: component.hostID,
      packageFormat: component.packageFormat,
      bridgeID: component.bridgeID,
      releaseChannel: component.releaseChannel,
    },
    release: {
      id: release.id,
      version: release.version,
      releaseNotes: release.releaseNotes,
      artifact: release.artifact,
      compatibility: release.compatibility,
    },
    capabilities: component.capabilities,
    widgets: widgets.map((widget) => ({
      id: widget.id,
      name: widget.name,
      icon: widget.icon,
      description: widget.description,
      previewImages: widget.previewImages,
      supportedSizes: widget.supportedSizes,
      states: widget.states,
    })),
    installable,
  };
  if (unavailableReason) result.unavailableReason = unavailableReason;
  assertPublicMetadataSafe(result);
  return result;
}

function summaryFor(contexts: readonly PublicComponentContext[], score: number): CatalogProductSummary {
  const first = contexts[0];
  if (!first) throw new Error("Cannot summarize an empty public component set.");
  const currentVersions: Record<ID, string> = {};
  const compatibleHostIDs = new Set<ID>();
  let widgetCount = 0;
  for (const context of contexts) {
    compatibleHostIDs.add(context.component.hostID);
    currentVersions[context.component.id] = context.release.version;
    widgetCount += context.widgets.length;
  }
  const summary: CatalogProductSummary = {
    productID: first.product.id,
    publisherID: first.publisher.id,
    publisherName: first.publisher.displayName,
    name: first.product.name,
    icon: first.product.icon,
    shortDescription: first.product.shortDescription,
    tags: first.product.tags,
    compatibleHostIDs: [...compatibleHostIDs].sort(),
    widgetCount,
    currentVersions,
    score,
  };
  assertPublicMetadataSafe(summary);
  return summary;
}

export class CatalogService {
  public constructor(private readonly store: MarketplaceStore) {}

  public async search(query: CatalogQuery = {}): Promise<CatalogPage<CatalogProductSummary>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 24));
    const publishers = await this.store.listPublishers();
    const publisherByID = new Map(publishers.map((publisher) => [publisher.id, publisher]));
    const products = await this.store.listProducts();
    const components = await this.store.listComponents();
    const releases = await this.store.listReleases();
    const widgets = await this.store.listWidgets();
    const widgetsByComponent = new Map<ID, Widget[]>();
    for (const widget of widgets) {
      const existing = widgetsByComponent.get(widget.componentID) ?? [];
      existing.push(widget);
      widgetsByComponent.set(widget.componentID, existing);
    }
    const contextsByProduct = new Map<ID, PublicComponentContext[]>();
    for (const component of components) {
      if (query.hostID && component.hostID !== query.hostID) continue;
      const product = products.find((candidate) => candidate.id === component.productID);
      if (query.publisherID && (!product || product.publisherID !== query.publisherID)) continue;
      const publisher = product ? publisherByID.get(product.publisherID) : undefined;
      const release = currentPublicRelease(component, releases);
      if (!product || !publisher || publisher.status !== "active" || product.publicationStatus !== "published" || !release) continue;
      const context: PublicComponentContext = {
        component,
        release,
        widgets: widgetsByComponent.get(component.id) ?? [],
        publisher,
        product,
      };
      const existing = contextsByProduct.get(product.id) ?? [];
      existing.push(context);
      contextsByProduct.set(product.id, existing);
    }
    const ranked = [...contextsByProduct.values()]
      .map((contexts) => {
        const first = contexts[0];
        if (!first) return { score: -1, contexts };
        const values = [
          first.product.name,
          first.product.shortDescription,
          ...first.product.tags,
          first.publisher.displayName,
          ...contexts.flatMap((context) => context.widgets.map((widget) => `${widget.name} ${widget.description}`)),
        ];
        return { score: scoreSearch(query.text ?? "", values), contexts };
      })
      .filter((entry) => entry.score >= 0)
      .sort((left, right) => right.score - left.score || (left.contexts[0]?.product.name ?? "").localeCompare(right.contexts[0]?.product.name ?? ""));
    const offset = (page - 1) * pageSize;
    const items = ranked.slice(offset, offset + pageSize).map((entry) => summaryFor(entry.contexts, entry.score));
    return { apiVersion: "v1", items, page, pageSize, total: ranked.length };
  }

  public async getProduct(productID: ID, hostID?: ID): Promise<CatalogProductDetail | undefined> {
    const product = await this.store.getProduct(productID);
    if (!product || product.publicationStatus !== "published") return undefined;
    const publisher = await this.store.getPublisher(product.publisherID);
    if (!publisher || publisher.status !== "active") return undefined;
    const components = await this.store.listComponents(productID);
    const releases = await this.store.listReleases();
    const widgets = await this.store.listWidgets();
    const publicContexts: PublicComponentContext[] = [];
    for (const component of components) {
      const release = currentPublicRelease(component, releases);
      if (!release) continue;
      const componentWidgets = widgets.filter((widget) => widget.componentID === component.id);
      publicContexts.push({ component, release, widgets: componentWidgets, publisher, product });
    }
    if (publicContexts.length === 0) return undefined;
    const matchingContexts = hostID ? publicContexts.filter((context) => context.component.hostID === hostID) : publicContexts;
    const summary = summaryFor(publicContexts, 0);
    const detail: CatalogProductDetail = {
      ...summary,
      sourceRepositoryURL: product.sourceRepositoryURL,
      licenseIdentifier: product.licenseIdentifier,
      licenseURL: product.licenseURL,
      supportURL: product.supportURL,
      privacyPolicyURL: product.privacyPolicyURL,
      screenshots: product.screenshots,
      components: matchingContexts.map((context) => publicComponent(context, true)),
    };
    assertPublicMetadataSafe(detail);
    return detail;
  }

  public async listHosts() {
    const hosts = (await this.store.listHosts()).filter((host) => host.lifecycle !== "retired");
    hosts.forEach((host) => assertPublicMetadataSafe(host));
    return hosts;
  }
}
