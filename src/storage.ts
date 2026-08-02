import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  ArtifactRecord,
  AuditEvent,
  Host,
  HostComponent,
  ID,
  Product,
  Publisher,
  Release,
  Submission,
  Widget,
} from "./domain";
import { isInstallableRelease, releaseImmutableFingerprint } from "./domain";
import { isSafePackagePath } from "./validation";

export interface PackageFile {
  path: string;
  data: Uint8Array;
}

export interface SqlExecutor {
  query<T>(sql: string, parameters?: readonly unknown[]): Promise<readonly T[]>;
  transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T>;
}

export interface MarketplaceStore {
  getPublisher(id: ID): Promise<Publisher | undefined>;
  listPublishers(): Promise<readonly Publisher[]>;
  savePublisher(publisher: Publisher): Promise<void>;
  getProduct(id: ID): Promise<Product | undefined>;
  listProducts(): Promise<readonly Product[]>;
  saveProduct(product: Product): Promise<void>;
  getHost(id: ID): Promise<Host | undefined>;
  listHosts(): Promise<readonly Host[]>;
  saveHost(host: Host): Promise<void>;
  getComponent(id: ID): Promise<HostComponent | undefined>;
  listComponents(productID?: ID): Promise<readonly HostComponent[]>;
  saveComponent(component: HostComponent): Promise<void>;
  getWidget(id: ID): Promise<Widget | undefined>;
  listWidgets(componentID?: ID): Promise<readonly Widget[]>;
  saveWidget(widget: Widget): Promise<void>;
  getRelease(id: ID): Promise<Release | undefined>;
  listReleases(componentID?: ID): Promise<readonly Release[]>;
  saveRelease(release: Release): Promise<void>;
  getSubmission(id: ID): Promise<Submission | undefined>;
  listSubmissions(publisherID?: ID): Promise<readonly Submission[]>;
  saveSubmission(submission: Submission): Promise<void>;
  appendAuditEvent(event: AuditEvent): Promise<void>;
  listAuditEvents(entityID?: ID): Promise<readonly AuditEvent[]>;
  transaction<T>(work: (store: MarketplaceStore) => Promise<T>): Promise<T>;
}

type EntityTable = "publishers" | "products" | "hosts" | "components" | "widgets" | "releases" | "submissions" | "audit_events";

type Entity = Publisher | Product | Host | HostComponent | Widget | Release | Submission | AuditEvent;

const tableFor = {
  publisher: "publishers",
  product: "products",
  host: "hosts",
  component: "components",
  widget: "widgets",
  release: "releases",
  submission: "submissions",
  audit: "audit_events",
} as const satisfies Record<string, EntityTable>;

async function readEntity<T extends Entity>(executor: SqlExecutor, table: EntityTable, id: ID): Promise<T | undefined> {
  const rows = await executor.query<{ data: T }>(`SELECT data FROM ${table} WHERE id = $1`, [id]);
  return rows[0]?.data;
}

async function listEntities<T extends Entity>(executor: SqlExecutor, table: EntityTable): Promise<readonly T[]> {
  const rows = await executor.query<{ data: T }>(`SELECT data FROM ${table} ORDER BY created_at ASC, id ASC`);
  return rows.map((row) => row.data);
}

async function saveEntity(executor: SqlExecutor, table: EntityTable, entity: Entity): Promise<void> {
  await executor.query(
    `INSERT INTO ${table} (id, data, created_at, updated_at)
     VALUES ($1, $2::jsonb, COALESCE(($2::jsonb ->> 'createdAt')::timestamptz, now()), COALESCE(($2::jsonb ->> 'updatedAt')::timestamptz, now()))
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
    [entity.id, JSON.stringify(entity)],
  );
}

export class SqlMarketplaceStore implements MarketplaceStore {
  public constructor(private readonly executor: SqlExecutor) {}

  public getPublisher(id: ID): Promise<Publisher | undefined> {
    return readEntity<Publisher>(this.executor, tableFor.publisher, id);
  }

  public listPublishers(): Promise<readonly Publisher[]> {
    return listEntities<Publisher>(this.executor, tableFor.publisher);
  }

  public savePublisher(publisher: Publisher): Promise<void> {
    return saveEntity(this.executor, tableFor.publisher, publisher);
  }

  public getProduct(id: ID): Promise<Product | undefined> {
    return readEntity<Product>(this.executor, tableFor.product, id);
  }

  public listProducts(): Promise<readonly Product[]> {
    return listEntities<Product>(this.executor, tableFor.product);
  }

  public saveProduct(product: Product): Promise<void> {
    return saveEntity(this.executor, tableFor.product, product);
  }

  public getHost(id: ID): Promise<Host | undefined> {
    return readEntity<Host>(this.executor, tableFor.host, id);
  }

  public listHosts(): Promise<readonly Host[]> {
    return listEntities<Host>(this.executor, tableFor.host);
  }

  public saveHost(host: Host): Promise<void> {
    return saveEntity(this.executor, tableFor.host, host);
  }

  public getComponent(id: ID): Promise<HostComponent | undefined> {
    return readEntity<HostComponent>(this.executor, tableFor.component, id);
  }

  public async listComponents(productID?: ID): Promise<readonly HostComponent[]> {
    const components = await listEntities<HostComponent>(this.executor, tableFor.component);
    return productID ? components.filter((component) => component.productID === productID) : components;
  }

  public saveComponent(component: HostComponent): Promise<void> {
    return saveEntity(this.executor, tableFor.component, component);
  }

  public getWidget(id: ID): Promise<Widget | undefined> {
    return readEntity<Widget>(this.executor, tableFor.widget, id);
  }
  public saveWidget(widget: Widget): Promise<void> {
    return saveEntity(this.executor, tableFor.widget, widget);
  }

  public async listWidgets(componentID?: ID): Promise<readonly Widget[]> {
    const widgets = await listEntities<Widget>(this.executor, tableFor.widget);
    return componentID ? widgets.filter((widget) => widget.componentID === componentID) : widgets;
  }

  public getRelease(id: ID): Promise<Release | undefined> {
    return readEntity<Release>(this.executor, tableFor.release, id);
  }

  public async listReleases(componentID?: ID): Promise<readonly Release[]> {
    const releases = await listEntities<Release>(this.executor, tableFor.release);
    return componentID ? releases.filter((release) => release.componentID === componentID) : releases;
  }

  public async saveRelease(release: Release): Promise<void> {
    const existing = await this.getRelease(release.id);
    if (existing && existing.status === "published" && releaseImmutableFingerprint(existing) !== releaseImmutableFingerprint(release)) {
      throw new Error("Published release metadata and artifact are immutable.");
    }
    await saveEntity(this.executor, tableFor.release, release);
  }

  public getSubmission(id: ID): Promise<Submission | undefined> {
    return readEntity<Submission>(this.executor, tableFor.submission, id);
  }

  public async listSubmissions(publisherID?: ID): Promise<readonly Submission[]> {
    const submissions = await listEntities<Submission>(this.executor, tableFor.submission);
    return publisherID ? submissions.filter((submission) => submission.publisherID === publisherID) : submissions;
  }

  public saveSubmission(submission: Submission): Promise<void> {
    return saveEntity(this.executor, tableFor.submission, submission);
  }

  public appendAuditEvent(event: AuditEvent): Promise<void> {
    return saveEntity(this.executor, tableFor.audit, event);
  }

  public async listAuditEvents(entityID?: ID): Promise<readonly AuditEvent[]> {
    const events = await listEntities<AuditEvent>(this.executor, tableFor.audit);
    return entityID ? events.filter((event) => event.entityID === entityID) : events;
  }

  public async transaction<T>(work: (store: MarketplaceStore) => Promise<T>): Promise<T> {
    return this.executor.transaction(async (transaction) => work(new SqlMarketplaceStore(transaction)));
  }
}

function createMaps() {
  return {
    publishers: new Map<ID, Publisher>(),
    products: new Map<ID, Product>(),
    hosts: new Map<ID, Host>(),
    components: new Map<ID, HostComponent>(),
    widgets: new Map<ID, Widget>(),
    releases: new Map<ID, Release>(),
    submissions: new Map<ID, Submission>(),
    auditEvents: new Map<ID, AuditEvent>(),
  };
}

type MemoryMaps = ReturnType<typeof createMaps>;

export class MemoryMarketplaceStore implements MarketplaceStore {
  private maps: MemoryMaps = createMaps();

  public getPublisher(id: ID): Promise<Publisher | undefined> {
    return Promise.resolve(structuredClone(this.maps.publishers.get(id)));
  }

  public listPublishers(): Promise<readonly Publisher[]> {
    return Promise.resolve(structuredClone([...this.maps.publishers.values()]));
  }

  public async savePublisher(publisher: Publisher): Promise<void> {
    this.maps.publishers.set(publisher.id, structuredClone(publisher));
  }

  public getProduct(id: ID): Promise<Product | undefined> {
    return Promise.resolve(structuredClone(this.maps.products.get(id)));
  }

  public listProducts(): Promise<readonly Product[]> {
    return Promise.resolve(structuredClone([...this.maps.products.values()]));
  }

  public async saveProduct(product: Product): Promise<void> {
    this.maps.products.set(product.id, structuredClone(product));
  }

  public getHost(id: ID): Promise<Host | undefined> {
    return Promise.resolve(structuredClone(this.maps.hosts.get(id)));
  }

  public listHosts(): Promise<readonly Host[]> {
    return Promise.resolve(structuredClone([...this.maps.hosts.values()]));
  }

  public async saveHost(host: Host): Promise<void> {
    this.maps.hosts.set(host.id, structuredClone(host));
  }

  public getComponent(id: ID): Promise<HostComponent | undefined> {
    return Promise.resolve(structuredClone(this.maps.components.get(id)));
  }

  public listComponents(productID?: ID): Promise<readonly HostComponent[]> {
    const components = [...this.maps.components.values()];
    const filtered = productID ? components.filter((component) => component.productID === productID) : components;
    return Promise.resolve(structuredClone(filtered));
  }

  public async saveComponent(component: HostComponent): Promise<void> {
    this.maps.components.set(component.id, structuredClone(component));
  }

  public getWidget(id: ID): Promise<Widget | undefined> {
    return Promise.resolve(structuredClone(this.maps.widgets.get(id)));
  }

  public listWidgets(componentID?: ID): Promise<readonly Widget[]> {
    const widgets = [...this.maps.widgets.values()];
    const filtered = componentID ? widgets.filter((widget) => widget.componentID === componentID) : widgets;
    return Promise.resolve(structuredClone(filtered));
  }
  public async saveWidget(widget: Widget): Promise<void> {
    this.maps.widgets.set(widget.id, structuredClone(widget));
  }

  public getRelease(id: ID): Promise<Release | undefined> {
    return Promise.resolve(structuredClone(this.maps.releases.get(id)));
  }

  public listReleases(componentID?: ID): Promise<readonly Release[]> {
    const releases = [...this.maps.releases.values()];
    const filtered = componentID ? releases.filter((release) => release.componentID === componentID) : releases;
    return Promise.resolve(structuredClone(filtered));
  }

  public async saveRelease(release: Release): Promise<void> {
    const existing = this.maps.releases.get(release.id);
    if (existing && existing.status === "published" && releaseImmutableFingerprint(existing) !== releaseImmutableFingerprint(release)) {
      throw new Error("Published release metadata and artifact are immutable.");
    }
    this.maps.releases.set(release.id, structuredClone(release));
  }

  public getSubmission(id: ID): Promise<Submission | undefined> {
    return Promise.resolve(structuredClone(this.maps.submissions.get(id)));
  }

  public listSubmissions(publisherID?: ID): Promise<readonly Submission[]> {
    const submissions = [...this.maps.submissions.values()];
    const filtered = publisherID ? submissions.filter((submission) => submission.publisherID === publisherID) : submissions;
    return Promise.resolve(structuredClone(filtered));
  }

  public async saveSubmission(submission: Submission): Promise<void> {
    this.maps.submissions.set(submission.id, structuredClone(submission));
  }

  public async appendAuditEvent(event: AuditEvent): Promise<void> {
    this.maps.auditEvents.set(event.id, structuredClone(event));
  }

  public listAuditEvents(entityID?: ID): Promise<readonly AuditEvent[]> {
    const events = [...this.maps.auditEvents.values()];
    const filtered = entityID ? events.filter((event) => event.entityID === entityID) : events;
    return Promise.resolve(structuredClone(filtered));
  }

  public async transaction<T>(work: (store: MarketplaceStore) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.maps);
    try {
      return await work(this);
    } catch (error) {
      this.maps = snapshot;
      throw error;
    }
  }
}

export interface ArtifactStore {
  putBundle(files: readonly PackageFile[], digest: string, metadata: Pick<ArtifactRecord, "binaryName" | "binaryDigest">): Promise<ArtifactRecord>;
  readBundle(digest: string): Promise<readonly PackageFile[]>;
  hasBundle(digest: string): Promise<boolean>;
}


export class FileArtifactStore implements ArtifactStore {
  public constructor(private readonly root: string) {}

  public async putBundle(files: readonly PackageFile[], digest: string, metadata: Pick<ArtifactRecord, "binaryName" | "binaryDigest">): Promise<ArtifactRecord> {
    if (!(await this.hasBundle(digest))) {
      const parent = join(this.root, "sha256");
      const temporary = join(parent, `${digest}.tmp-${crypto.randomUUID()}`);
      await mkdir(temporary, { recursive: true });
      try {
        for (const file of files) {
          if (!isSafePackagePath(file.path)) throw new Error(`Unsafe artifact path: ${file.path}`);
          const target = join(temporary, file.path);
          await mkdir(join(target, ".."), { recursive: true });
          await Bun.write(target, file.data);
        }
        await rename(temporary, join(parent, digest));
      } catch (error) {
        await rm(temporary, { recursive: true, force: true });
        throw error;
      }
    }
    const sizeBytes = files.reduce((total, file) => total + file.data.byteLength, 0);
    return {
      digest,
      objectKey: `sha256/${digest}`,
      sizeBytes,
      contentType: "application/vnd.tosh.notchbridge",
      fileCount: files.length,
      binaryName: metadata.binaryName,
      binaryDigest: metadata.binaryDigest,
      immutable: true,
    };
  }

  public async readBundle(digest: string): Promise<readonly PackageFile[]> {
    const root = join(this.root, "sha256", digest);
    const result: PackageFile[] = [];
    const visit = async (directory: string, prefix: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await visit(path, relative);
        else if (entry.isFile()) result.push({ path: relative, data: new Uint8Array(await Bun.file(path).arrayBuffer()) });
        else throw new Error(`Artifact contains unsupported filesystem entry: ${relative}`);
      }
    };
    await visit(root, "");
    return result.sort((left, right) => left.path.localeCompare(right.path));
  }

  public async hasBundle(digest: string): Promise<boolean> {
    return Bun.file(join(this.root, "sha256", digest, "manifest.json")).exists();
  }
}

export class MemoryArtifactStore implements ArtifactStore {
  private readonly bundles = new Map<string, readonly PackageFile[]>();

  public async putBundle(files: readonly PackageFile[], digest: string, metadata: Pick<ArtifactRecord, "binaryName" | "binaryDigest">): Promise<ArtifactRecord> {
    if (!this.bundles.has(digest)) this.bundles.set(digest, files.map((file) => ({ path: file.path, data: new Uint8Array(file.data) })));
    return {
      digest,
      objectKey: `memory://sha256/${digest}`,
      sizeBytes: files.reduce((total, file) => total + file.data.byteLength, 0),
      contentType: "application/vnd.tosh.notchbridge",
      fileCount: files.length,
      binaryName: metadata.binaryName,
      binaryDigest: metadata.binaryDigest,
      immutable: true,
    };
  }

  public async readBundle(digest: string): Promise<readonly PackageFile[]> {
    const bundle = this.bundles.get(digest);
    if (!bundle) throw new Error(`Artifact not found: ${digest}`);
    return bundle.map((file) => ({ path: file.path, data: new Uint8Array(file.data) }));
  }

  public hasBundle(digest: string): Promise<boolean> {
    return Promise.resolve(this.bundles.has(digest));
  }
}

export function isStoredReleaseInstallable(release: Release): boolean {
  return isInstallableRelease(release) && release.artifact.immutable;
}
