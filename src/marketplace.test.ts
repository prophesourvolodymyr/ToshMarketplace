import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { CatalogService } from "./catalog";
import { createMarketplaceHandler } from "./http";
import {
  compatibilityFor,
  type CapabilityDeclaration,
  type Host,
  type HostComponent,
  type Product,
  type Publisher,
  type Release,
  type ReviewReport,
  type Widget,
} from "./domain";
import { MemoryArtifactStore, MemoryMarketplaceStore, type PackageFile } from "./storage";
import { FixedWindowSubmissionRateLimiter, PublishingService, type ReviewProvider } from "./publishing";
import { buildSigningPayload, loadPackageDirectory, validatePackageFiles, type PackageManifest } from "./validation";

const now = "2026-07-30T00:00:00.000Z";
const capability: CapabilityDeclaration = {
  id: "network",
  title: "Network",
  explanation: "Fetches provider metadata.",
  risk: "low",
  dataClasses: ["public-provider-data"],
};

function baseHost(id: string): Host {
  return {
    id,
    bundleID: `com.tosh.${id}`,
    displayName: id === "notchintosh" ? "NotchinTosh" : "Tosh Other",
    icon: "app",
    packageFormat: "notchbridge",
    sdkVersion: { minimum: "1.0.0" },
    platformVersion: { minimum: "14.0.0", maximum: "16.0.0" },
    deepLinkScheme: `${id}://marketplace`,
    downloadURL: `https://tosh.example/${id}`,
    capabilityCatalogVersion: "1",
    lifecycle: "active",
  };
}

function basePublisher(publicKey: string): Publisher {
  return {
    id: "pub.example",
    username: "example",
    displayName: "Example Publisher",
    status: "active",
    contactEmail: "support@example.test",
    supportURL: "https://example.test/support",
    developerModeEnabled: true,
    termsAcceptedAt: now,
    signingKeys: [{ keyID: "key-1", algorithm: "Ed25519", publicKey, createdAt: now }],
    createdAt: now,
    updatedAt: now,
  };
}

function baseProduct(status: Product["publicationStatus"] = "published"): Product {
  return {
    id: "product.example",
    publisherID: "pub.example",
    name: "Focus Widget",
    icon: "target",
    shortDescription: "A focused widget for the Tosh notch.",
    screenshots: [],
    supportedHostIDs: ["notchintosh"],
    componentIDs: ["component.notchintosh"],
    sourceRepositoryURL: "https://github.com/example/focus-widget",
    licenseIdentifier: "MIT",
    licenseURL: "https://spdx.org/licenses/MIT.html",
    supportURL: "https://example.test/support",
    privacyPolicyURL: "https://example.test/privacy",
    tags: ["focus", "productivity"],
    publicationStatus: status,
    createdAt: now,
    updatedAt: now,
  };
}

function baseComponent(id = "component.notchintosh", hostID = "notchintosh"): HostComponent {
  return {
    id,
    productID: "product.example",
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

function baseWidget(componentID = "component.notchintosh"): Widget {
  return {
    id: componentID === "component.notchintosh" ? "widget.focus" : `${componentID}.widget`,
    componentID,
    name: "Focus",
    icon: "target",
    description: "Shows the current focus mode.",
    previewImages: [],
    supportedSizes: ["compact", "wide"],
    layoutDescription: "Compact focus status.",
    states: ["loading", "ready", "empty", "error", "offline", "permissionDenied", "unavailable", "invalidInput"],
    settingsSchema: [],
    actions: [],
    capabilityIDs: ["network"],
    portIDs: [],
    available: true,
  };
}

function manifestFor(version: string): PackageManifest {
  const states = ["loading", "ready", "empty", "error", "offline", "permissionDenied", "unavailable", "invalidInput"].map((id) => ({ id, title: id, message: id, recoverable: true, supportedSizes: ["compact", "wide"] }));
  return {
    manifestVersion: 1,
    id: "com.example.focus",
    publisherID: "pub.example",
    displayName: "Focus Widget",
    version,
    minimumSDKVersion: "1.0.0",
    minimumMacOSMajorVersion: 14,
    widgets: [{
      id: "widget.focus",
      title: "Focus",
      symbol: "target",
      description: "Shows the current focus mode.",
      supportedSizes: ["compact", "wide"],
      supportedTabs: ["home"],
      supportsMultipleInstances: false,
      supportsMoving: true,
      settings: [{ id: "mode", title: "Mode", kind: "choice", defaultValue: "work" }],
      actions: [{ id: "open", title: "Open" }],
      ports: [{ id: "focus", direction: "provides", schema: "com.example.focus.v1" }],
      permissions: [],
      states,
      sizeBehaviors: [
        { id: "compact", description: "Compact", supportsInteraction: true, supportedStates: states.map((state) => state.id) },
        { id: "wide", description: "Wide", supportsInteraction: true, supportedStates: states.map((state) => state.id) },
      ],
      customization: { options: [{ id: "accent", title: "Accent", kind: "choice", defaultValue: "blue" }] },
    }],
  };
}

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function signedPackage(version = "1.0.0") {
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" } as AlgorithmIdentifier, true, ["sign", "verify"]) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const binary = new TextEncoder().encode(`bridge-${version}`);
  const binaryBytes = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength) as ArrayBuffer;
  const binaryDigest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", binaryBytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const manifest = manifestFor(version);
  const assets = ["assets/preview.png"];
  const payload = buildSigningPayload(manifest, "FocusBridge", binaryDigest, assets);
  const payloadBytes = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" } as AlgorithmIdentifier, keys.privateKey, payloadBytes));
  const envelope = {
    binarySHA256: binaryDigest,
    manifest,
    binaryName: "FocusBridge",
    signature: base64(signature),
    publisherPublicKey: base64(publicKey),
    assets,
  };
  const files: PackageFile[] = [
    { path: "manifest.json", data: new TextEncoder().encode(JSON.stringify(envelope)) },
    { path: "FocusBridge", data: binary },
    { path: "assets/preview.png", data: new Uint8Array([137, 80, 78, 71]) },
  ];
  return { files, publicKey: base64(publicKey), envelope };
}

async function seedMarketplace(store: MemoryMarketplaceStore, publicKey: string): Promise<void> {
  await store.savePublisher(basePublisher(publicKey));
  await store.saveHost(baseHost("notchintosh"));
  await store.saveProduct(baseProduct());
  await store.saveComponent(baseComponent());
  await store.saveWidget(baseWidget());
}

function publishedRelease(id: string, componentID: string, version: string, status: Release["status"] = "published"): Release {
  return {
    id,
    componentID,
    version,
    releaseNotes: "Initial release",
    artifact: {
      digest: id.padEnd(64, "0").slice(0, 64),
      objectKey: `sha256/${id}`,
      sizeBytes: 10,
      contentType: "application/vnd.tosh.notchbridge",
      fileCount: 2,
      binaryName: "FocusBridge",
      binaryDigest: "a".repeat(64),
      immutable: true,
    },
    signature: { algorithm: "Ed25519", keyID: "key-1", publicKey: "public", signature: "signature", verified: true, verifiedAt: now },
    compatibility: {
      hostID: componentID === "component.other" ? "other" : "notchintosh",
      packageFormat: "notchbridge",
      hostVersion: { minimum: "1.0.0" },
      sdkVersion: { minimum: "1.0.0" },
      platformVersion: { minimum: "14.0.0", maximum: "16.0.0" },
    },
    capabilityDiff: [],
    reviewStatus: status === "published" ? "passed" : "escalated",
    status,
    publishedAt: status === "published" ? now : undefined,
    createdAt: now,
    updatedAt: now,
  };
}

function reviewer(reviewerID: string, score = 90, decision: ReviewReport["recommendedDecision"] = "approve", capabilityRisk: ReviewReport["capabilityRisk"] = "low"): ReviewProvider {
  return {
    reviewerID,
    modelID: `${reviewerID}-model`,
    promptVersion: "policy-1",
    async review() {
      return {
        usefulnessScore: score,
        integrationScore: score,
        qualityScore: score,
        originalityScore: score,
        capabilityRisk,
        flags: [],
        explanation: "Review complete.",
        recommendedDecision: decision,
        confidence: 0.95,
      };
    },
  };
}

describe("F04-A catalog and storage contracts", () => {
  test("filters published products by host and excludes quarantined releases", async () => {
    const store = new MemoryMarketplaceStore();
    await store.savePublisher(basePublisher("public-key"));
    await store.saveHost(baseHost("notchintosh"));
    await store.saveHost(baseHost("other"));
    await store.saveProduct(baseProduct());
    await store.saveComponent(baseComponent());
    await store.saveComponent({ ...baseComponent("component.other", "other"), bridgeID: "com.example.focus.other", widgetIDs: ["widget.other"] });
    await store.saveWidget(baseWidget());
    await store.saveWidget(baseWidget("component.other"));
    await store.saveRelease(publishedRelease("release.notch", "component.notchintosh", "1.0.0", "quarantined"));
    await store.saveRelease(publishedRelease("release.other", "component.other", "1.0.0"));
    const catalog = new CatalogService(store);
    const all = await catalog.search();
    expect(all.total).toBe(1);
    expect(all.items[0]?.compatibleHostIDs).toEqual(["other"]);
    const notch = await catalog.search({ hostID: "notchintosh" });
    expect(notch.total).toBe(0);
    expect(JSON.stringify(all)).not.toContain("privateKey");
    expect(JSON.stringify(all)).not.toContain("runtimeData");
  });

  test("does not expose draft products or package paths", async () => {
    const store = new MemoryMarketplaceStore();
    await store.savePublisher(basePublisher("public-key"));
    await store.saveHost(baseHost("notchintosh"));
    await store.saveProduct(baseProduct("draft"));
    await store.saveComponent(baseComponent());
    await store.saveWidget(baseWidget());
    await store.saveRelease(publishedRelease("release.draft", "component.notchintosh", "1.0.0"));
    const catalog = new CatalogService(store);
    expect((await catalog.search()).total).toBe(0);
    expect(await catalog.getProduct("product.example")).toBeUndefined();
  });
  test("serves versioned public catalog routes and protects publisher routes", async () => {
    const fixture = await signedPackage();
    const store = new MemoryMarketplaceStore();
    await seedMarketplace(store, fixture.publicKey);
    await store.saveRelease(publishedRelease("release.http", "component.notchintosh", "1.0.0"));
    const catalog = new CatalogService(store);
    const publishing = new PublishingService(store, new MemoryArtifactStore(), [reviewer("reviewer-a"), reviewer("reviewer-b")]);
    const handler = createMarketplaceHandler(catalog, publishing, { authorize: async () => ({ authorized: false, status: 401, message: "Publisher authorization is required." }) });
    const catalogResponse = await handler(new Request("https://marketplace.test/v1/catalog/products?q=focus"));
    expect(catalogResponse.status).toBe(200);
    expect((await catalogResponse.json()).apiVersion).toBe("v1");
    const product = await catalog.getProduct("product.example");
    expect(product?.components[0]?.capabilities).toEqual([capability]);
    const privateResponse = await handler(new Request("https://marketplace.test/v1/publishers/pub.example/submissions", { method: "POST", body: "{}" }));
    expect(privateResponse.status).toBe(401);
  });
  test("rejects incompatible host and SDK versions before installation", () => {
    const result = compatibilityFor(baseComponent(), baseHost("notchintosh"), "0.9.0", "0.9.0", "13.0.0");
    expect(result.compatible).toBe(false);
    expect(result.reasons).toHaveLength(3);
  });
});

describe("F04-A package validation", () => {
  test("accepts a signed package and rejects tampered binary and source payloads", async () => {
    const fixture = await signedPackage();
    const valid = await validatePackageFiles(fixture.files, { expectedPublisherID: "pub.example", expectedHostID: "notchintosh", requireSignature: true, trustedPublicKeys: [fixture.publicKey] });
    expect(valid.ok).toBe(true);
    const tampered = fixture.files.map((file) => file.path === "FocusBridge" ? { ...file, data: new Uint8Array([1, 2, 3]) } : file);
    const invalid = await validatePackageFiles([...tampered, { path: "Sources/Secret.swift", data: new Uint8Array([1]) }], { expectedPublisherID: "pub.example", expectedHostID: "notchintosh", requireSignature: true, trustedPublicKeys: [fixture.publicKey] });
    expect(invalid.ok).toBe(false);
    expect(invalid.errors.some((error) => error.includes("digest") || error.includes("signature"))).toBe(true);
    expect(invalid.errors.some((error) => error.includes("Source"))).toBe(true);
  });

  test("allows unsigned local development only when explicitly requested", async () => {
    const fixture = await signedPackage();
    const envelope = JSON.parse(new TextDecoder().decode(fixture.files[0]!.data));
    delete envelope.signature;
    delete envelope.publisherPublicKey;
    const files = fixture.files.map((file) => file.path === "manifest.json" ? { ...file, data: new TextEncoder().encode(JSON.stringify(envelope)) } : file);
    const local = await validatePackageFiles(files, { expectedPublisherID: "pub.example", expectedHostID: "notchintosh", requireSignature: false });
    expect(local.ok).toBe(true);
    const publicResult = await validatePackageFiles(files, { expectedPublisherID: "pub.example", expectedHostID: "notchintosh", requireSignature: true });
    expect(publicResult.ok).toBe(false);
  });
  test("reads a signed local package directory format", async () => {
    const fixture = await signedPackage();
    const packageRoot = await mkdtemp(join(tmpdir(), "tosh-marketplace-package-"));
    try {
      for (const file of fixture.files) {
        const targetPath = join(packageRoot, file.path);
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, file.data);
      }
      const files = await loadPackageDirectory(packageRoot);
      const result = await validatePackageFiles(files, { expectedPublisherID: "pub.example", expectedHostID: "notchintosh", requireSignature: true, trustedPublicKeys: [fixture.publicKey] });
      expect(result.ok).toBe(true);
      expect(result.envelope?.manifest.id).toBe("com.example.focus");
      expect(result.warnings).toHaveLength(0);
    } finally {
      await rm(packageRoot, { recursive: true, force: true });
    }
  });
});

describe("F04-B publishing lifecycle", () => {
  test("validates, reviews, publishes atomically, and preserves release immutability", async () => {
    const fixture = await signedPackage("1.0.0");
    const store = new MemoryMarketplaceStore();
    await seedMarketplace(store, fixture.publicKey);
    const artifacts = new MemoryArtifactStore();
    const publishing = new PublishingService(store, artifacts, [reviewer("reviewer-a"), reviewer("reviewer-b")]);
    const result = await publishing.submit({ actorID: "pub.example", publisherID: "pub.example", productID: "product.example", componentID: "component.notchintosh", version: "1.0.0", releaseNotes: "Initial release", files: fixture.files });
    expect(result.validation.ok).toBe(true);
    expect(result.submission.status).toBe("approved");
    const approved = await store.getRelease(result.submission.releaseID!);
    expect(approved?.status).toBe("approved");
    const published = await publishing.publish(result.submission.releaseID!, "pub.example");
    expect(published.status).toBe("published");
    expect(await artifacts.hasBundle(published.artifact.digest)).toBe(true);
    expect((await artifacts.readBundle(published.artifact.digest)).some((file) => file.path === "FocusBridge")).toBe(true);
    const updated = { ...published, releaseNotes: "tampered" };
    await expect(store.saveRelease(updated)).rejects.toThrow("immutable");
    expect((await new CatalogService(store).search()).total).toBe(1);
  });

  test("rejects invalid updates without replacing the prior published release", async () => {
    const fixture = await signedPackage("2.0.0");
    const store = new MemoryMarketplaceStore();
    await seedMarketplace(store, fixture.publicKey);
    await store.saveRelease(publishedRelease("release.old", "component.notchintosh", "1.0.0"));
    await store.saveComponent({ ...(await store.getComponent("component.notchintosh"))!, currentReleaseID: "release.old" });
    const publishing = new PublishingService(store, new MemoryArtifactStore(), [reviewer("reviewer-a"), reviewer("reviewer-b")]);
    const invalidFiles = fixture.files.map((file) => file.path === "manifest.json" ? { ...file, data: new TextEncoder().encode("not json") } : file);
    const result = await publishing.submit({ actorID: "pub.example", publisherID: "pub.example", productID: "product.example", componentID: "component.notchintosh", version: "2.0.0", releaseNotes: "Bad update", files: invalidFiles });
    expect(result.submission.status).toBe("rejected");
    expect((await store.getRelease("release.old"))?.status).toBe("published");
    expect((await store.listReleases("component.notchintosh")).length).toBe(1);
  });

  test("escalates reviewer disagreement and records human decisions", async () => {
    const fixture = await signedPackage("3.0.0");
    const store = new MemoryMarketplaceStore();
    await seedMarketplace(store, fixture.publicKey);
    const publishing = new PublishingService(store, new MemoryArtifactStore(), [reviewer("reviewer-a", 95), reviewer("reviewer-b", 40)]);
    const result = await publishing.submit({ actorID: "pub.example", publisherID: "pub.example", productID: "product.example", componentID: "component.notchintosh", version: "3.0.0", releaseNotes: "Needs human review", files: fixture.files });
    expect(result.submission.status).toBe("needs-human-review");
    const approved = await publishing.decideHuman(result.submission.releaseID!, { reviewerID: "human-1", decision: "approve", reason: "Reviewed manually", evidence: ["manual-check"], createdAt: now });
    expect(approved.status).toBe("approved");
    await publishing.publish(approved.id, "human-1");
    const submission = await store.getSubmission(result.submission.id);
    expect(submission?.status).toBe("published");
    expect((await store.listAuditEvents(result.submission.id)).length).toBeGreaterThanOrEqual(2);
  });

  test("rotates signing keys without invalidating prior release history", async () => {
    const first = await signedPackage("4.0.0");
    const second = await signedPackage("5.0.0");
    const store = new MemoryMarketplaceStore();
    await seedMarketplace(store, first.publicKey);
    const publishing = new PublishingService(store, new MemoryArtifactStore(), [reviewer("reviewer-a"), reviewer("reviewer-b")]);
    const initial = await publishing.submit({ actorID: "pub.example", publisherID: "pub.example", productID: "product.example", componentID: "component.notchintosh", version: "4.0.0", releaseNotes: "Initial key", files: first.files });
    await publishing.publish(initial.submission.releaseID!, "pub.example");
    await publishing.rotatePublisherKey("pub.example", { keyID: "key-2", algorithm: "Ed25519", publicKey: second.publicKey, createdAt: now }, "pub.example");
    const rotated = await publishing.submit({ actorID: "pub.example", publisherID: "pub.example", productID: "product.example", componentID: "component.notchintosh", version: "5.0.0", releaseNotes: "Rotated key", files: second.files });
    expect(rotated.submission.status).toBe("approved");
    expect((await store.getRelease(initial.submission.releaseID!))?.status).toBe("published");
    expect((await store.getRelease(rotated.submission.releaseID!))?.signature.keyID).toBe("key-2");
  });

  test("escalates sensitive capabilities instead of auto-publishing", async () => {
    const fixture = await signedPackage("6.0.0");
    const store = new MemoryMarketplaceStore();
    await seedMarketplace(store, fixture.publicKey);
    const publishing = new PublishingService(store, new MemoryArtifactStore(), [reviewer("reviewer-a", 95, "approve", "sensitive"), reviewer("reviewer-b", 95, "approve", "sensitive")]);
    const result = await publishing.submit({ actorID: "pub.example", publisherID: "pub.example", productID: "product.example", componentID: "component.notchintosh", version: "6.0.0", releaseNotes: "Sensitive capability", files: fixture.files });
    expect(result.submission.status).toBe("needs-human-review");
    expect((await store.getRelease(result.submission.releaseID!))?.status).toBe("under-review");
  });

  test("quarantines a published release and removes it from the public catalog", async () => {
    const fixture = await signedPackage("7.0.0");
    const store = new MemoryMarketplaceStore();
    await seedMarketplace(store, fixture.publicKey);
    const publishing = new PublishingService(store, new MemoryArtifactStore(), [reviewer("reviewer-a"), reviewer("reviewer-b")]);
    const result = await publishing.submit({ actorID: "pub.example", publisherID: "pub.example", productID: "product.example", componentID: "component.notchintosh", version: "7.0.0", releaseNotes: "Security event", files: fixture.files });
    await publishing.publish(result.submission.releaseID!, "pub.example");
    const quarantined = await publishing.decideHuman(result.submission.releaseID!, { reviewerID: "security-1", decision: "quarantine", reason: "Security report", evidence: ["incident-1"], createdAt: now });
    expect(quarantined.status).toBe("quarantined");
    expect((await new CatalogService(store).search()).total).toBe(0);
  });

  test("enforces a submission rate limit window", async () => {
    const limiter = new FixedWindowSubmissionRateLimiter(1, 1_000);
    expect(await limiter.allow("pub.example", new Date(0))).toBe(true);
    expect(await limiter.allow("pub.example", new Date(500))).toBe(false);
    expect(await limiter.allow("pub.example", new Date(1_000))).toBe(true);
  });

});
