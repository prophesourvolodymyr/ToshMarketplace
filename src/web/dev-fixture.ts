import { CatalogService } from "../catalog";
import type {
  CapabilityDeclaration,
  Host,
  HostComponent,
  Product,
  Publisher,
  Release,
  ReviewReport,
  Widget,
} from "../domain";
import type { MarketplaceAuthorizer } from "../http";
import { PublishingService, type ReviewProvider } from "../publishing";
import { MemoryArtifactStore, MemoryMarketplaceStore } from "../storage";

const fixtureNow = "2026-08-03T00:00:00.000Z";
const publisherID = "publisher.field-guide";
const focusProductID = "product.focus-field-guide";
const weatherProductID = "product.weather-window";
const notchHostID = "notchintosh";
const launchHostID = "launchintosh";

const calendarCapability: CapabilityDeclaration = {
  id: "calendar.read",
  title: "Calendar events",
  explanation: "Reads the next event title and time so the widget can show what is coming up.",
  risk: "medium",
  dataClasses: ["calendar metadata"],
};

const networkCapability: CapabilityDeclaration = {
  id: "network.fetch",
  title: "Network requests",
  explanation: "Fetches public forecast data from the configured weather provider.",
  risk: "low",
  dataClasses: ["public provider data"],
};

function fixtureHost(id: string, displayName: string, icon: string, downloadURL: string): Host {
  return {
    id,
    bundleID: `com.tosh.${id}`,
    displayName,
    icon,
    packageFormat: "notchbridge",
    sdkVersion: { minimum: "1.0.0" },
    platformVersion: { minimum: "14.0.0", maximum: "16.0.0" },
    deepLinkScheme: `${id}://marketplace`,
    downloadURL,
    capabilityCatalogVersion: "1",
    lifecycle: "active",
  };
}

function fixturePublisher(): Publisher {
  return {
    id: publisherID,
    username: "field-guide",
    displayName: "Field Guide Studio",
    status: "active",
    contactEmail: "",
    supportURL: "https://field-guide.example/support",
    developerModeEnabled: true,
    termsAcceptedAt: fixtureNow,
    signingKeys: [],
    createdAt: fixtureNow,
    updatedAt: fixtureNow,
  };
}

function fixtureProduct(
  id: string,
  name: string,
  icon: string,
  shortDescription: string,
  supportedHostIDs: readonly string[],
  componentIDs: readonly string[],
  tags: readonly string[],
): Product {
  return {
    id,
    publisherID,
    name,
    icon,
    shortDescription,
    screenshots: [{ path: "/private/fixture/previews/hero.png", width: 1200, height: 760, contentType: "image/png" }],
    supportedHostIDs,
    componentIDs,
    sourceRepositoryURL: "https://github.com/tosh-company/public-field-guide",
    licenseIdentifier: "MIT",
    licenseURL: "https://spdx.org/licenses/MIT.html",
    supportURL: "https://field-guide.example/support",
    privacyPolicyURL: "https://field-guide.example/privacy",
    tags,
    publicationStatus: "published",
    createdAt: fixtureNow,
    updatedAt: fixtureNow,
  };
}

function fixtureComponent(
  id: string,
  productID: string,
  hostID: string,
  bridgeID: string,
  widgetIDs: readonly string[],
  capabilities: readonly CapabilityDeclaration[],
): HostComponent {
  return {
    id,
    productID,
    hostID,
    packageFormat: "notchbridge",
    bridgeID,
    minimumHostVersion: "1.0.0",
    minimumSDKVersion: "1.0.0",
    supportedPlatform: { minimum: "14.0.0", maximum: "16.0.0" },
    widgetIDs,
    capabilities,
    releaseChannel: "stable",
  };
}

function fixtureWidget(id: string, componentID: string, name: string, icon: string, description: string, sizes: readonly string[], states: readonly string[]): Widget {
  return {
    id,
    componentID,
    name,
    icon,
    description,
    previewImages: [{ path: "/private/fixture/packages/widget-preview.webp", width: 640, height: 400, contentType: "image/webp" }],
    supportedSizes: sizes,
    layoutDescription: "Declarative public preview metadata.",
    states,
    settingsSchema: [],
    actions: [],
    capabilityIDs: [],
    portIDs: [],
    available: true,
  };
}

function fixtureRelease(id: string, componentID: string, hostID: string, version: string, notes: string): Release {
  return {
    id,
    componentID,
    version,
    releaseNotes: notes,
    artifact: {
      digest: "a".repeat(64),
      objectKey: `fixture/private/${id}`,
      sizeBytes: 2048,
      contentType: "application/vnd.tosh.notchbridge",
      fileCount: 2,
      binaryName: `${id}.bridge`,
      binaryDigest: "b".repeat(64),
      immutable: true,
    },
    signature: {
      algorithm: "Ed25519",
      keyID: "fixture-key",
      publicKey: "fixture-public-key",
      signature: "fixture-signature",
      verified: true,
      verifiedAt: fixtureNow,
    },
    compatibility: {
      hostID,
      packageFormat: "notchbridge",
      hostVersion: { minimum: "1.0.0" },
      sdkVersion: { minimum: "1.0.0" },
      platformVersion: { minimum: "14.0.0", maximum: "16.0.0" },
    },
    capabilityDiff: [],
    reviewStatus: "passed",
    status: "published",
    publishedAt: fixtureNow,
    createdAt: fixtureNow,
    updatedAt: fixtureNow,
  };
}

function fixtureReviewer(reviewerID: string): ReviewProvider {
  return {
    reviewerID,
    modelID: `${reviewerID}-model`,
    promptVersion: "fixture-policy-1",
    async review(): Promise<Omit<ReviewReport, "reviewerID" | "modelID" | "promptVersion" | "createdAt">> {
      return {
        usefulnessScore: 90,
        integrationScore: 90,
        qualityScore: 90,
        originalityScore: 90,
        capabilityRisk: "low",
        flags: [],
        explanation: "Fixture review.",
        recommendedDecision: "approve",
        confidence: 0.95,
      };
    },
  };
}

export interface MarketplaceWebFixture {
  store: MemoryMarketplaceStore;
  artifacts: MemoryArtifactStore;
  catalog: CatalogService;
  publishing: PublishingService;
  authorizer: MarketplaceAuthorizer;
}

export async function createMarketplaceWebFixture(): Promise<MarketplaceWebFixture> {
  const store = new MemoryMarketplaceStore();
  const artifacts = new MemoryArtifactStore();
  await store.savePublisher(fixturePublisher());
  await store.saveHost(fixtureHost(notchHostID, "NotchinTosh", "notch", "https://tosh.example/notchintosh"));
  await store.saveHost(fixtureHost(launchHostID, "LaunchinTosh", "launch", "https://tosh.example/launchintosh"));
  await store.saveProduct(fixtureProduct(focusProductID, "Focus Field Guide", "focus", "One calm note for what matters next.", [notchHostID, launchHostID], ["component.focus.notch", "component.focus.launch"], ["focus", "productivity", "daily"]));
  await store.saveProduct(fixtureProduct(weatherProductID, "Weather Window", "weather", "A quick forecast for the launch bar.", [launchHostID], ["component.weather.launch"], ["weather", "planning"]));
  await store.saveComponent(fixtureComponent("component.focus.notch", focusProductID, notchHostID, "com.tosh.focus.notch", ["widget.focus.next"], [calendarCapability]));
  await store.saveComponent(fixtureComponent("component.focus.launch", focusProductID, launchHostID, "com.tosh.focus.launch", ["widget.focus.next", "widget.focus.note"], [calendarCapability]));
  await store.saveComponent(fixtureComponent("component.weather.launch", weatherProductID, launchHostID, "com.tosh.weather.launch", ["widget.weather.today"], [networkCapability]));
  await store.saveWidget(fixtureWidget("widget.focus.next", "component.focus.notch", "Next up", "next", "Shows the next calendar event without opening the host app.", ["compact", "wide"], ["loading", "ready", "empty", "offline"]));
  await store.saveWidget(fixtureWidget("widget.focus.note", "component.focus.launch", "Daily note", "note", "Keeps one short intention visible in the launch bar.", ["compact"], ["ready", "empty", "permissionDenied"]));
  await store.saveWidget(fixtureWidget("widget.weather.today", "component.weather.launch", "Today", "sun", "Shows a public forecast summary and temperature range.", ["compact", "wide"], ["loading", "ready", "error", "offline"]));
  await store.saveRelease(fixtureRelease("release.focus.notch.1", "component.focus.notch", notchHostID, "1.2.0", "Clearer empty state."));
  await store.saveRelease(fixtureRelease("release.focus.launch.1", "component.focus.launch", launchHostID, "1.2.0", "Keeps the daily note visible."));
  await store.saveRelease(fixtureRelease("release.weather.launch.1", "component.weather.launch", launchHostID, "2.0.1", "Better offline fallback."));
  const publishing = new PublishingService(store, artifacts, [fixtureReviewer("fixture-reviewer-a"), fixtureReviewer("fixture-reviewer-b")]);
  const catalog = new CatalogService(store);
  const authorizer: MarketplaceAuthorizer = {
    async authorize(): Promise<{ authorized: false; status: 401; message: string }> {
      return { authorized: false, status: 401, message: "Publisher authorization is required." };
    },
  };
  return { store, artifacts, catalog, publishing, authorizer };
}
