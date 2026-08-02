export const MARKETPLACE_API_VERSION = "1";
export const MARKETPLACE_SCHEMA_VERSION = 1;

export type ID = string;
export type ISODateString = string;

export type PublisherStatus = "active" | "restricted" | "suspended" | "removed";
export type ProductPublicationStatus = "draft" | "published" | "archived";
export type HostLifecycle = "active" | "preview" | "deprecated" | "retired";
export type ReleaseChannel = "stable" | "beta" | "nightly";
export type ReleaseStatus =
  | "draft"
  | "validating"
  | "under-review"
  | "approved"
  | "published"
  | "rejected"
  | "quarantined"
  | "revoked"
  | "archived"
  | "superseded";
export type ReviewStatus = "not-started" | "in-progress" | "passed" | "escalated" | "rejected";
export type SubmissionStatus =
  | "validating"
  | "rejected"
  | "under-review"
  | "needs-human-review"
  | "approved"
  | "published"
  | "quarantined";
export type CapabilityRisk = "none" | "low" | "medium" | "high" | "sensitive";

export interface VersionRange {
  minimum: string;
  maximum?: string;
}

export interface HostCompatibility {
  hostID: ID;
  packageFormat: string;
  hostVersion: VersionRange;
  sdkVersion: VersionRange;
  platformVersion: VersionRange;
}

export interface CapabilityDeclaration {
  id: string;
  title: string;
  explanation: string;
  risk: CapabilityRisk;
  dataClasses: readonly string[];
}

export interface WidgetPreview {
  path: string;
  width: number;
  height: number;
  contentType: "image/png" | "image/jpeg" | "image/webp";
}

export interface PublisherSigningKey {
  keyID: ID;
  algorithm: "Ed25519";
  publicKey: string;
  createdAt: ISODateString;
  revokedAt?: ISODateString;
}

export interface Publisher {
  id: ID;
  username: string;
  displayName: string;
  status: PublisherStatus;
  contactEmail: string;
  supportURL: string;
  developerModeEnabled: boolean;
  termsAcceptedAt?: ISODateString;
  signingKeys: readonly PublisherSigningKey[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface Host {
  id: ID;
  bundleID: string;
  displayName: string;
  icon: string;
  packageFormat: string;
  sdkVersion: VersionRange;
  platformVersion: VersionRange;
  deepLinkScheme: string;
  downloadURL: string;
  capabilityCatalogVersion: string;
  lifecycle: HostLifecycle;
}

export interface Product {
  id: ID;
  publisherID: ID;
  name: string;
  icon: string;
  shortDescription: string;
  screenshots: readonly WidgetPreview[];
  supportedHostIDs: readonly ID[];
  componentIDs: readonly ID[];
  sourceRepositoryURL?: string;
  licenseIdentifier: string;
  licenseURL?: string;
  supportURL: string;
  privacyPolicyURL?: string;
  tags: readonly string[];
  publicationStatus: ProductPublicationStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface HostComponent {
  id: ID;
  productID: ID;
  hostID: ID;
  packageFormat: string;
  bridgeID: string;
  artifactDigest?: string;
  publisherSignature?: SignatureRecord;
  minimumHostVersion: string;
  minimumSDKVersion: string;
  supportedPlatform: VersionRange;
  widgetIDs: readonly ID[];
  capabilities: readonly CapabilityDeclaration[];
  releaseChannel: ReleaseChannel;
  currentReleaseID?: ID;
}

export interface Widget {
  id: ID;
  componentID: ID;
  name: string;
  icon: string;
  description: string;
  previewImages: readonly WidgetPreview[];
  supportedSizes: readonly string[];
  layoutDescription: string;
  states: readonly string[];
  settingsSchema: readonly Record<string, unknown>[];
  actions: readonly Record<string, unknown>[];
  capabilityIDs: readonly string[];
  portIDs: readonly string[];
  available: boolean;
}

export interface SignatureRecord {
  algorithm: "Ed25519";
  keyID: ID;
  publicKey: string;
  signature: string;
  verified: boolean;
  verifiedAt?: ISODateString;
}

export interface ArtifactRecord {
  digest: string;
  objectKey: string;
  sizeBytes: number;
  contentType: string;
  fileCount: number;
  binaryName: string;
  binaryDigest: string;
  immutable: true;
}

export interface Release {
  id: ID;
  componentID: ID;
  version: string;
  releaseNotes: string;
  artifact: ArtifactRecord;
  signature: SignatureRecord;
  compatibility: HostCompatibility;
  capabilityDiff: readonly CapabilityDeclaration[];
  reviewStatus: ReviewStatus;
  status: ReleaseStatus;
  publishedAt?: ISODateString;
  quarantinedAt?: ISODateString;
  revokedAt?: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface ReviewReport {
  reviewerID: string;
  modelID: string;
  promptVersion: string;
  usefulnessScore: number;
  integrationScore: number;
  qualityScore: number;
  originalityScore: number;
  capabilityRisk: CapabilityRisk;
  flags: readonly string[];
  explanation: string;
  recommendedDecision: "approve" | "reject" | "escalate";
  confidence: number;
  createdAt: ISODateString;
}

export interface HumanDecision {
  reviewerID: string;
  decision: "approve" | "reject" | "request-changes" | "quarantine" | "revoke";
  reason: string;
  evidence: readonly string[];
  createdAt: ISODateString;
}

export interface Submission {
  id: ID;
  publisherID: ID;
  productID: ID;
  componentID: ID;
  releaseID?: ID;
  version: string;
  releaseNotes: string;
  status: SubmissionStatus;
  validationErrors: readonly string[];
  reviewReports: readonly ReviewReport[];
  humanDecisions: readonly HumanDecision[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface AuditEvent {
  id: ID;
  actorID: ID;
  action: string;
  entityType: string;
  entityID: ID;
  metadata: Readonly<Record<string, string | number | boolean>>;
  createdAt: ISODateString;
}

export interface CatalogQuery {
  text?: string;
  hostID?: ID;
  publisherID?: ID;
  page?: number;
  pageSize?: number;
}

export interface CatalogProductSummary {
  productID: ID;
  publisherID: ID;
  publisherName: string;
  name: string;
  icon: string;
  shortDescription: string;
  tags: readonly string[];
  compatibleHostIDs: readonly ID[];
  widgetCount: number;
  currentVersions: Readonly<Record<ID, string>>;
  score: number;
}

export interface CatalogComponent {
  component: Pick<HostComponent, "id" | "hostID" | "packageFormat" | "bridgeID" | "releaseChannel">;
  release: Pick<Release, "id" | "version" | "releaseNotes" | "artifact" | "compatibility">;
  widgets: readonly Pick<Widget, "id" | "name" | "icon" | "description" | "previewImages" | "supportedSizes" | "states">[];
  installable: boolean;
  unavailableReason?: string;
}

export interface CatalogProductDetail extends CatalogProductSummary {
  sourceRepositoryURL?: string;
  licenseIdentifier: string;
  licenseURL?: string;
  supportURL: string;
  privacyPolicyURL?: string;
  screenshots: readonly WidgetPreview[];
  components: readonly CatalogComponent[];
}

export interface CatalogPage<T> {
  apiVersion: string;
  items: readonly T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CompatibilityResult {
  compatible: boolean;
  reasons: readonly string[];
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const HEX_DIGEST = /^[a-f0-9]{64}$/i;

export function isSemver(value: string): boolean {
  return SEMVER.test(value);
}

export function compareSemver(left: string, right: string): number {
  const parse = (value: string) => value.split("+")[0]?.split("-")[0]?.split(".").map(Number) ?? [];
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const leftPart = a[index] ?? 0;
    const rightPart = b[index] ?? 0;
    if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

export function satisfiesVersion(value: string, range: VersionRange): boolean {
  if (!isSemver(value) || !isSemver(range.minimum)) return false;
  if (compareSemver(value, range.minimum) < 0) return false;
  return !range.maximum || (isSemver(range.maximum) && compareSemver(value, range.maximum) <= 0);
}

export function isValidDigest(value: string): boolean {
  return HEX_DIGEST.test(value);
}

export function compatibilityFor(
  component: HostComponent,
  host: Host,
  hostVersion: string,
  sdkVersion: string,
  platformVersion: string,
): CompatibilityResult {
  const reasons: string[] = [];
  if (component.hostID !== host.id) reasons.push("The component targets a different host.");
  if (component.packageFormat !== host.packageFormat) reasons.push("The package format is unsupported by this host.");
  if (!satisfiesVersion(hostVersion, { minimum: component.minimumHostVersion })) {
    reasons.push("The host version is below the component minimum.");
  }
  if (!satisfiesVersion(sdkVersion, { minimum: component.minimumSDKVersion })) {
    reasons.push("The SDK version is below the component minimum.");
  }
  if (!satisfiesVersion(platformVersion, component.supportedPlatform)) {
    reasons.push("The platform version is outside the component range.");
  }
  if (host.lifecycle === "retired") reasons.push("The target host is retired.");
  return { compatible: reasons.length === 0, reasons };
}

export function isInstallableRelease(release: Release): boolean {
  return release.status === "published" && release.reviewStatus === "passed" && !release.quarantinedAt && !release.revokedAt;
}

export function assertPublicMetadataSafe(value: unknown, path = "metadata"): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublicMetadataSafe(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object") throw new Error(`${path} contains an unsupported value.`);
  for (const [key, child] of Object.entries(value)) {
    if (/(?:password|credential|token|secret|keychain|runtimeData|mediaContent|rawUserFile|privateKey)/i.test(key)) {
      throw new Error(`${path}.${key} is not allowed in marketplace metadata.`);
    }
    assertPublicMetadataSafe(child, `${path}.${key}`);
  }
}

export function releaseImmutableFingerprint(release: Release): string {
  return JSON.stringify({
    componentID: release.componentID,
    version: release.version,
    releaseNotes: release.releaseNotes,
    artifact: release.artifact,
    signature: release.signature,
    compatibility: release.compatibility,
    capabilityDiff: release.capabilityDiff,
    createdAt: release.createdAt,
  });
}

export function nowISO(clock: () => Date = () => new Date()): ISODateString {
  return clock().toISOString();
}
