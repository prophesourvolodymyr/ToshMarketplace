import { describe, expect, test } from "bun:test";
import { CatalogService } from "./catalog";
import { ToshBearerIdentityProvider, ToshMarketplaceAuthorizer, type ToshAccountIdentity } from "./account-authorization";
import type { CapabilityDeclaration, Host, HostComponent, Product, Publisher, ReviewReport } from "./domain";
import { createMarketplaceHandler } from "./http";
import { FixedWindowSubmissionRateLimiter, PublishingService, type ReviewProvider } from "./publishing";
import { PostgresSqlExecutor, postgresConfigFromEnvironment, type PostgresClientLike, type PostgresQueryClientLike } from "./postgres";
import { S3ArtifactStore, type ObjectStorageObject, type ObjectStorageTransport } from "./object-storage";
import { MemoryArtifactStore, MemoryMarketplaceStore, SqlMarketplaceStore, type PackageFile, type SqlExecutor } from "./storage";
import { buildSigningPayload, calculatePackageDigest, sha256Digest, type PackageManifest } from "./validation";

const now = "2026-08-01T00:00:00.000Z";
const publisherID = "pub.example";
const productID = "product.example";
const componentID = "component.notchintosh";
const hostID = "notchintosh";

interface QueryRecord {
  sql: string;
  parameters: readonly unknown[];
}

type EntityRows = Map<string, Map<string, unknown>>;

function emptyEntityRows(): EntityRows {
  return new Map(["publishers", "products", "hosts", "components", "widgets", "releases", "submissions", "audit_events"].map((table) => [table, new Map()]));
}

function cloneEntityRows(source: EntityRows): EntityRows {
  return new Map([...source.entries()].map(([table, rows]) => [table, new Map([...rows.entries()].map(([id, value]) => [id, structuredClone(value)]))]));
}

class FakePostgresQueryClient implements PostgresQueryClientLike {
  public constructor(private readonly rows: EntityRows, private readonly queries: QueryRecord[]) {}

  public async unsafe<T>(sql: string, parameters: readonly unknown[] = []): Promise<readonly T[]> {
    this.queries.push({ sql, parameters: [...parameters] });
    const select = /^SELECT data FROM ([a-z_]+)(?: WHERE id = \$1)?/.exec(sql);
    if (select) {
      const rows = this.rows.get(select[1]!);
      if (!rows) throw new Error("Unknown fake SQL table.");
      if (sql.includes("WHERE id = $1")) {
        const data = rows.get(String(parameters[0]));
        return data === undefined ? [] : [{ data } as T];
      }
      return [...rows.values()].map((data) => ({ data }) as T);
    }
    const insert = /^INSERT INTO ([a-z_]+)/.exec(sql);
    if (insert) {
      const rows = this.rows.get(insert[1]!);
      if (!rows) throw new Error("Unknown fake SQL table.");
      const id = String(parameters[0]);
      rows.set(id, JSON.parse(String(parameters[1])));
      return [];
    }
    throw new Error(`Unexpected fake SQL: ${sql}`);
  }
}

class FakePostgresClient implements PostgresClientLike {
  private rows = emptyEntityRows();
  public readonly queries: QueryRecord[] = [];
  public beginCount = 0;
  public commitCount = 0;
  public rollbackCount = 0;
  public endCalls: Array<{ timeout?: number }> = [];

  public unsafe<T>(sql: string, parameters?: readonly unknown[]): Promise<readonly T[]> {
    return new FakePostgresQueryClient(this.rows, this.queries).unsafe<T>(sql, parameters);
  }

  public async begin<T>(work: (transaction: PostgresQueryClientLike) => Promise<T>): Promise<T> {
    this.beginCount += 1;
    const transactionRows = cloneEntityRows(this.rows);
    try {
      const result = await work(new FakePostgresQueryClient(transactionRows, this.queries));
      this.rows = transactionRows;
      this.commitCount += 1;
      return result;
    } catch (error) {
      this.rollbackCount += 1;
      throw error;
    }
  }

  public async end(options?: { timeout?: number }): Promise<void> {
    this.endCalls.push(options ?? {});
  }
}

class FakeObjectStorageTransport implements ObjectStorageTransport {
  private readonly objects = new Map<string, { data: Uint8Array; metadata: Readonly<Record<string, string>> }>();
  public readonly writes: string[] = [];

  public seed(key: string, data: Uint8Array, metadata: Readonly<Record<string, string>> = {}): void {
    this.objects.set(key, { data: new Uint8Array(data), metadata: { ...metadata } });
  }

  public async putObjectIfAbsent(key: string, data: Uint8Array, metadata: Readonly<Record<string, string>>): Promise<boolean> {
    this.writes.push(key);
    if (this.objects.has(key)) return false;
    this.objects.set(key, { data: new Uint8Array(data), metadata: { ...metadata } });
    return true;
  }

  public async headObject(key: string): Promise<ObjectStorageObject | undefined> {
    const object = this.objects.get(key);
    return object ? { sizeBytes: object.data.byteLength, metadata: object.metadata } : undefined;
  }

  public async getObject(key: string): Promise<Uint8Array> {
    const object = this.objects.get(key);
    if (!object) throw new Error("Fake object not found.");
    return new Uint8Array(object.data);
  }

  public async listObjectKeys(prefix: string): Promise<readonly string[]> {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix));
  }
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function base64(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data));
}

function baseHost(): Host {
  return {
    id: hostID,
    bundleID: "com.tosh.notchintosh",
    displayName: "NotchinTosh",
    icon: "app",
    packageFormat: "notchbridge",
    sdkVersion: { minimum: "1.0.0" },
    platformVersion: { minimum: "14.0.0", maximum: "16.0.0" },
    deepLinkScheme: "notchintosh://marketplace",
    downloadURL: "https://tosh.example/notchintosh",
    capabilityCatalogVersion: "1",
    lifecycle: "active",
  };
}

const capability: CapabilityDeclaration = {
  id: "network",
  title: "Network",
  explanation: "Fetches public provider data.",
  risk: "low",
  dataClasses: ["public-provider-data"],
};
function basePublisher(publicKey: string, status: Publisher["status"] = "active", developerModeEnabled = true, termsAcceptedAt: string | null = now): Publisher {
  return {
    id: publisherID,
    username: "example",
    displayName: "Example Publisher",
    status,
    contactEmail: "support@example.test",
    supportURL: "https://example.test/support",
    developerModeEnabled,
    termsAcceptedAt: termsAcceptedAt === null ? undefined : termsAcceptedAt,
    signingKeys: [{ keyID: "key-1", algorithm: "Ed25519", publicKey, createdAt: now }],
    createdAt: now,
    updatedAt: now,
  };
}

function baseProduct(): Product {
  return {
    id: productID,
    publisherID,
    name: "Focus Widget",
    icon: "target",
    shortDescription: "A focused widget for the Tosh notch.",
    screenshots: [],
    supportedHostIDs: [hostID],
    componentIDs: [componentID],
    sourceRepositoryURL: "https://github.com/example/focus-widget",
    licenseIdentifier: "MIT",
    licenseURL: "https://spdx.org/licenses/MIT.html",
    supportURL: "https://example.test/support",
    privacyPolicyURL: "https://example.test/privacy",
    tags: ["focus"],
    publicationStatus: "published",
    createdAt: now,
    updatedAt: now,
  };
}

function baseComponent(): HostComponent {
  return {
    id: componentID,
    productID,
    hostID,
    packageFormat: "notchbridge",
    bridgeID: "com.example.focus",
    minimumHostVersion: "1.0.0",
    minimumSDKVersion: "1.0.0",
    supportedPlatform: { minimum: "14.0.0", maximum: "16.0.0" },
    widgetIDs: ["widget.focus"],
    capabilities: [capability],
    releaseChannel: "stable",
  };
}

function packageManifest(version: string): PackageManifest {
  const stateIDs = ["loading", "ready", "empty", "error", "offline", "permissionDenied", "unavailable", "invalidInput"];
  const states = stateIDs.map((id) => ({ id, title: id, message: id, recoverable: true, supportedSizes: ["compact"] }));
  return {
    manifestVersion: 1,
    id: "com.example.focus",
    publisherID,
    displayName: "Focus Widget",
    version,
    minimumSDKVersion: "1.0.0",
    minimumMacOSMajorVersion: 14,
    widgets: [{
      id: "widget.focus",
      title: "Focus",
      symbol: "target",
      description: "Shows the current focus mode.",
      supportedSizes: ["compact"],
      supportedTabs: ["home"],
      supportsMultipleInstances: false,
      supportsMoving: true,
      settings: [{ id: "mode", title: "Mode" }],
      actions: [{ id: "open", title: "Open" }],
      ports: [{ id: "focus", direction: "provides", schema: "com.example.focus.v1" }],
      permissions: [],
      states,
      sizeBehaviors: [{ id: "compact", description: "Compact", supportsInteraction: true, supportedStates: stateIDs }],
      customization: { options: [{ id: "accent", title: "Accent" }] },
    }],
  };
}

async function signedSubmissionPackage(version = "1.0.0"): Promise<{ files: PackageFile[]; publicKey: string }> {
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" } as AlgorithmIdentifier, true, ["sign", "verify"]) as CryptoKeyPair;
  const publicKey = base64(new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey)));
  const binary = text(`bridge-${version}`);
  const binaryDigest = await sha256Digest(binary);
  const manifest = packageManifest(version);
  const assets = ["assets/preview.png"];
  const payload = buildSigningPayload(manifest, "FocusBridge", binaryDigest, assets);
  const payloadBytes = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" } as AlgorithmIdentifier, keys.privateKey, payloadBytes));
  const envelope = { binarySHA256: binaryDigest, manifest, binaryName: "FocusBridge", signature: base64(signature), publisherPublicKey: publicKey, assets };
  return {
    publicKey,
    files: [
      { path: "manifest.json", data: text(JSON.stringify(envelope)) },
      { path: "FocusBridge", data: binary },
      { path: "assets/preview.png", data: new Uint8Array([137, 80, 78, 71]) },
    ],
  };
}

async function seedSubmissionStore(store: MemoryMarketplaceStore, fixture: { publicKey: string }, options: { status?: Publisher["status"]; developerModeEnabled?: boolean; termsAcceptedAt?: string | null } = {}): Promise<void> {
  await store.savePublisher(basePublisher(fixture.publicKey, options.status ?? "active", options.developerModeEnabled ?? true, options.termsAcceptedAt === undefined ? now : options.termsAcceptedAt));
  await store.saveHost(baseHost());
  await store.saveProduct(baseProduct());
  await store.saveComponent(baseComponent());
}

function reviewer(reviewerID: string): ReviewProvider {
  return {
    reviewerID,
    modelID: `${reviewerID}-model`,
    promptVersion: "policy-1",
    async review(): Promise<Omit<ReviewReport, "reviewerID" | "modelID" | "promptVersion" | "createdAt">> {
      return {
        usefulnessScore: 90,
        integrationScore: 90,
        qualityScore: 90,
        originalityScore: 90,
        capabilityRisk: "low",
        flags: [],
        explanation: "Review complete.",
        recommendedDecision: "approve",
        confidence: 0.95,
      };
    },
  };
}

function submissionBody(files: readonly PackageFile[], version: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    productID,
    componentID,
    version,
    releaseNotes: "Initial release",
    files: files.map((file) => ({ path: file.path, base64: base64(file.data) })),
    ...extra,
  });
}

async function httpFixture(options: { status?: Publisher["status"]; developerModeEnabled?: boolean; termsAcceptedAt?: string | null; rateLimiter?: FixedWindowSubmissionRateLimiter } = {}): Promise<{
  handler: (request: Request) => Promise<Response>;
  store: MemoryMarketplaceStore;
  fixture: { files: PackageFile[]; publicKey: string };
}> {
  const fixture = await signedSubmissionPackage();
  const store = new MemoryMarketplaceStore();
  await seedSubmissionStore(store, fixture, options);
  const publishing = new PublishingService(store, new MemoryArtifactStore(), [reviewer("reviewer-a"), reviewer("reviewer-b")], {}, () => new Date(now), options.rateLimiter);
  const catalog = new CatalogService(store);
  const identity: ToshAccountIdentity = { accountID: "account.example", publisherID };
  const provider = new ToshBearerIdentityProvider({
    authenticateBearerToken: async (token) => token === "opaque-test-token" ? identity : undefined,
  });
  const authorizer = new ToshMarketplaceAuthorizer(provider, store);
  return { handler: createMarketplaceHandler(catalog, publishing, authorizer), store, fixture };
}

function submissionRequest(files: readonly PackageFile[], token = "opaque-test-token", version = "1.0.0", extra: Record<string, unknown> = {}): Request {
  return new Request(`https://marketplace.test/v1/publishers/${publisherID}/submissions`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: submissionBody(files, version, extra),
  });
}

async function expectError(response: Response, status: number, code: string): Promise<string> {
  expect(response.status).toBe(status);
  const body = await response.json() as { error?: { code?: string; message?: string } };
  expect(body.error?.code).toBe(code);
  expect(typeof body.error?.message).toBe("string");
  return JSON.stringify(body);
}

describe("F04 service boundaries", () => {
  test("binds SQL IDs and JSON as parameters and commits or rolls back transactions", async () => {
    const client = new FakePostgresClient();
    const executor = new PostgresSqlExecutor(client, (work) => client.begin(work), () => client.end({ timeout: 5 }));
    const store = new SqlMarketplaceStore(executor);
    const publisher = basePublisher("public-key");
    const hostileID = "publisher'); DROP TABLE publishers; --";
    await store.savePublisher({ ...publisher, id: hostileID });
    expect(await store.getPublisher(hostileID)).toMatchObject({ id: hostileID });
    expect(client.queries.some((query) => query.sql.includes(hostileID))).toBe(false);
    expect(client.queries.some((query) => query.parameters.includes(hostileID))).toBe(true);
    expect(client.queries.some((query) => query.parameters.some((parameter) => typeof parameter === "string" && parameter.includes("Example Publisher")))).toBe(true);

    await store.transaction(async (transaction) => transaction.savePublisher({ ...publisher, id: "committed" }));
    expect(await store.getPublisher("committed")).toBeDefined();
    expect(client.beginCount).toBe(1);
    expect(client.commitCount).toBe(1);
    await expect(store.transaction(async (transaction) => {
      await transaction.savePublisher({ ...publisher, id: "rolled-back" });
      throw new Error("transaction failure");
    })).rejects.toThrow("transaction failure");
    expect(await store.getPublisher("rolled-back")).toBeUndefined();
    expect(client.rollbackCount).toBe(1);
    await expect(executor.transaction(async (transaction) => transaction.transaction(async () => undefined))).rejects.toThrow("Nested transactions");
    await executor.close();
    expect(client.endCalls).toEqual([{ timeout: 5 }]);
  });

  test("requires safe PostgreSQL environment configuration without exposing connection strings", () => {
    const connectionString = "postgres://opaque-user:opaque-password@db.example.test/marketplace";
    expect(() => postgresConfigFromEnvironment({})).toThrow("DATABASE_URL is required");
    expect(() => postgresConfigFromEnvironment({ DATABASE_URL: connectionString, DATABASE_MAX_CONNECTIONS: "zero" })).toThrow("DATABASE_MAX_CONNECTIONS");
    try {
      postgresConfigFromEnvironment({ DATABASE_URL: connectionString, DATABASE_IDLE_TIMEOUT_SECONDS: "-1" });
    } catch (error) {
      expect(String(error)).not.toContain(connectionString);
      expect(String(error)).not.toContain("opaque-password");
    }
    expect(postgresConfigFromEnvironment({ DATABASE_URL: connectionString, DATABASE_MAX_CONNECTIONS: "4", DATABASE_IDLE_TIMEOUT_SECONDS: "2", DATABASE_CONNECT_TIMEOUT_SECONDS: "3" })).toEqual({
      connectionString,
      maxConnections: 4,
      idleTimeoutSeconds: 2,
      connectTimeoutSeconds: 3,
    });
  });

  test("uploads immutable content-addressed bundles and reads them back", async () => {
    const files: PackageFile[] = [
      { path: "manifest.json", data: text("manifest") },
      { path: "FocusBridge", data: new Uint8Array([1, 2, 3, 4]) },
      { path: "assets/preview.png", data: new Uint8Array([137, 80, 78, 71]) },
    ];
    const digest = await calculatePackageDigest(files);
    const binaryDigest = await sha256Digest(files[1]!.data);
    const transport = new FakeObjectStorageTransport();
    const store = new S3ArtifactStore(transport);
    const artifact = await store.putBundle(files, digest, { binaryName: "FocusBridge", binaryDigest });
    expect(artifact.objectKey).toBe(`sha256/${digest}`);
    expect(transport.writes).toEqual([`sha256/${digest}/assets/preview.png`, `sha256/${digest}/FocusBridge`, `sha256/${digest}/manifest.json`]);
    expect(await store.hasBundle(digest)).toBe(true);
    expect((await store.readBundle(digest)).map((file) => file.path)).toEqual(["assets/preview.png", "FocusBridge", "manifest.json"]);
    const writes = transport.writes.length;
    expect(await store.putBundle(files, digest, { binaryName: "FocusBridge", binaryDigest })).toEqual(artifact);
    expect(transport.writes.length).toBe(writes);
  });

  test("rejects unsafe paths and both package and binary digest mismatches before writing", async () => {
    const files: PackageFile[] = [
      { path: "manifest.json", data: text("manifest") },
      { path: "FocusBridge", data: new Uint8Array([1, 2, 3]) },
    ];
    const digest = await calculatePackageDigest(files);
    const binaryDigest = await sha256Digest(files[1]!.data);
    const transport = new FakeObjectStorageTransport();
    const store = new S3ArtifactStore(transport);
    await expect(store.putBundle([{ path: "../escape", data: text("bad") }, ...files], digest, { binaryName: "FocusBridge", binaryDigest })).rejects.toThrow("integrity");
    await expect(store.putBundle(files, "a".repeat(64), { binaryName: "FocusBridge", binaryDigest })).rejects.toThrow("package digest");
    await expect(store.putBundle(files, digest, { binaryName: "FocusBridge", binaryDigest: "b".repeat(64) })).rejects.toThrow("binary digest");
    expect(transport.writes).toHaveLength(0);
  });

  test("fails closed on an immutable object conflict and incomplete marker", async () => {
    const files: PackageFile[] = [
      { path: "manifest.json", data: text("manifest") },
      { path: "FocusBridge", data: new Uint8Array([1, 2, 3]) },
    ];
    const digest = await calculatePackageDigest(files);
    const binaryDigest = await sha256Digest(files[1]!.data);
    const conflictTransport = new FakeObjectStorageTransport();
    conflictTransport.seed(`sha256/${digest}/FocusBridge`, new Uint8Array([9, 9, 9]));
    await expect(new S3ArtifactStore(conflictTransport).putBundle(files, digest, { binaryName: "FocusBridge", binaryDigest })).rejects.toThrow("immutable object differs");
    expect(conflictTransport.writes).toEqual([`sha256/${digest}/FocusBridge`]);

    const incompleteTransport = new FakeObjectStorageTransport();
    incompleteTransport.seed(`sha256/${digest}/FocusBridge`, files[1]!.data);
    const store = new S3ArtifactStore(incompleteTransport);
    expect(await store.hasBundle(digest)).toBe(false);
    await store.putBundle(files, digest, { binaryName: "FocusBridge", binaryDigest });
    expect(await store.hasBundle(digest)).toBe(true);
  });

  test("enforces Tosh bearer identity, publisher ownership, and publisher state", async () => {
    const fixture = await httpFixture();
    const unauthorized = await fixture.handler(new Request(`https://marketplace.test/v1/publishers/${publisherID}/submissions`, { method: "POST", body: "opaque-test-token" }));
    const unauthorizedSerialized = await expectError(unauthorized, 401, "unauthorized");
    expect(unauthorizedSerialized).not.toContain("opaque-test-token");

    const otherProvider = new ToshBearerIdentityProvider({ authenticateBearerToken: async () => ({ accountID: "account.other", publisherID: "publisher.other" }) });
    const otherHandler = createMarketplaceHandler(new CatalogService(fixture.store), new PublishingService(fixture.store, new MemoryArtifactStore(), [reviewer("reviewer-a"), reviewer("reviewer-b")]), new ToshMarketplaceAuthorizer(otherProvider, fixture.store));
    await expectError(await otherHandler(submissionRequest(fixture.fixture.files)), 403, "forbidden");

    for (const status of ["suspended", "removed"] as const) {
      const stateFixture = await httpFixture({ status });
      await expectError(await stateFixture.handler(submissionRequest(stateFixture.fixture.files)), 403, "forbidden");
    }
  });

  test("uses the authenticated actor and maps publisher publishing safeguards to 403", async () => {
    const fixture = await httpFixture();
    const success = await fixture.handler(submissionRequest(fixture.fixture.files, "opaque-test-token", "1.0.0", { actorID: "spoofed-body-actor" }));
    expect(success.status).toBe(202);
    const submission = (await fixture.store.listSubmissions())[0]!;
    expect((await fixture.store.listAuditEvents(submission.id))[0]?.actorID).toBe("account.example");

    const developerDisabled = await httpFixture({ developerModeEnabled: false });
    await expectError(await developerDisabled.handler(submissionRequest(developerDisabled.fixture.files)), 403, "forbidden");
    const termsMissing = await httpFixture({ termsAcceptedAt: null });
    await expectError(await termsMissing.handler(submissionRequest(termsMissing.fixture.files)), 403, "forbidden");
  });

  test("bounds JSON, strictly decodes base64, and maps duplicate and rate-limit failures", async () => {
    const oversized = await httpFixture();
    const oversizedRequest = new Request(`https://marketplace.test/v1/publishers/${publisherID}/submissions`, {
      method: "POST",
      headers: { authorization: "Bearer opaque-test-token", "content-length": String(100 * 1024 * 1024 + 1) },
      body: "{}",
    });
    await expectError(await oversized.handler(oversizedRequest), 413, "request_too_large");

    const invalid = await httpFixture();
    const invalidBody = new Request(`https://marketplace.test/v1/publishers/${publisherID}/submissions`, {
      method: "POST",
      headers: { authorization: "Bearer opaque-test-token", "content-type": "application/json" },
      body: submissionBody([{ path: "manifest.json", data: text("manifest") }], "1.0.0").replaceAll("bWFuaWZlc3Q=", "bWFuaWZlc3Q"),
    });
    const invalidSerialized = await expectError(await invalid.handler(invalidBody), 400, "request_failed");
    expect(invalidSerialized).not.toContain("opaque-test-token");

    const duplicate = await httpFixture();
    expect((await duplicate.handler(submissionRequest(duplicate.fixture.files))).status).toBe(202);
    await expectError(await duplicate.handler(submissionRequest(duplicate.fixture.files)), 409, "conflict");

    const limited = await httpFixture({ rateLimiter: new FixedWindowSubmissionRateLimiter(1, 60 * 60 * 1000) });
    expect((await limited.handler(submissionRequest(limited.fixture.files))).status).toBe(202);
    const secondFixture = await signedSubmissionPackage("2.0.0");
    await expectError(await limited.handler(submissionRequest(secondFixture.files, "opaque-test-token", "2.0.0")), 429, "rate_limited");
  });
});
