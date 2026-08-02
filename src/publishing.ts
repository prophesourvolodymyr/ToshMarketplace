import {
  assertPublicMetadataSafe,
  isSemver,
  nowISO,
  type AuditEvent,
  type CapabilityDeclaration,
  type HostComponent,
  type HumanDecision,
  type ID,
  type Product,
  type Publisher,
  type PublisherSigningKey,
  type Release,
  type ReviewReport,
  type Submission,
  type Widget,
} from "./domain";
import type { ArtifactStore, MarketplaceStore, PackageFile } from "./storage";
import {
  loadPackageDirectory,
  validatePackageFiles,
  type PackageManifest,
  type PackageValidationResult,
} from "./validation";

export interface SubmissionInput {
  actorID: ID;
  publisherID: ID;
  productID: ID;
  componentID: ID;
  version: string;
  releaseNotes: string;
  files: readonly PackageFile[];
}

export interface DirectorySubmissionInput extends Omit<SubmissionInput, "files"> {
  packageRoot: string;
}

export interface ReviewInput {
  releaseID: ID;
  publisher: Pick<Publisher, "id" | "username" | "displayName">;
  product: Pick<Product, "id" | "name" | "shortDescription" | "tags" | "licenseIdentifier" | "sourceRepositoryURL">;
  component: Pick<HostComponent, "id" | "hostID" | "bridgeID" | "packageFormat" | "capabilities">;
  manifest: PackageManifest;
  releaseVersion: string;
  releaseNotes: string;
}

export interface ReviewProvider {
  readonly reviewerID: string;
  readonly modelID: string;
  readonly promptVersion: string;
  review(input: ReviewInput): Promise<Omit<ReviewReport, "reviewerID" | "modelID" | "promptVersion" | "createdAt">>;
}

export interface ReviewPolicy {
  minimumUsefulnessScore: number;
  minimumIntegrationScore: number;
  minimumQualityScore: number;
  minimumOriginalityScore: number;
  agreementTolerance: number;
}

export interface SubmissionResult {
  submission: Submission;
  validation: PackageValidationResult;
}

export interface ProductInput {
  id: ID;
  publisherID: ID;
  name: string;
  icon: string;
  shortDescription: string;
  screenshots?: Product["screenshots"];
  sourceRepositoryURL?: string;
  licenseIdentifier: string;
  licenseURL?: string;
  supportURL: string;
  privacyPolicyURL?: string;
  tags?: readonly string[];
}

export interface ComponentInput {
  id: ID;
  productID: ID;
  hostID: ID;
  packageFormat: string;
  bridgeID: string;
  minimumHostVersion: string;
  minimumSDKVersion: string;
  supportedPlatform: HostComponent["supportedPlatform"];
  capabilities: readonly CapabilityDeclaration[];
  releaseChannel?: HostComponent["releaseChannel"];
}
export interface SubmissionRateLimiter {
  allow(publisherID: ID, now: Date): Promise<boolean>;
}

export class FixedWindowSubmissionRateLimiter implements SubmissionRateLimiter {
  private readonly windows = new Map<ID, { startedAt: number; count: number }>();

  public constructor(private readonly maximum: number = 5, private readonly windowMilliseconds: number = 60 * 60 * 1000) {}

  public async allow(publisherID: ID, now: Date): Promise<boolean> {
    const timestamp = now.getTime();
    const current = this.windows.get(publisherID);
    if (!current || timestamp - current.startedAt >= this.windowMilliseconds) {
      this.windows.set(publisherID, { startedAt: timestamp, count: 1 });
      return true;
    }
    if (current.count >= this.maximum) return false;
    current.count += 1;
    return true;
  }
}
export class SubmissionConflictError extends Error {
  public constructor(message: string) {
    super(message);
  }
}

export class SubmissionRateLimitError extends Error {
  public constructor() {
    super("Submission rate limit exceeded.");
  }
}


export interface WidgetInput extends Omit<Widget, "available"> {
  available?: boolean;
}

const DEFAULT_REVIEW_POLICY: ReviewPolicy = {
  minimumUsefulnessScore: 70,
  minimumIntegrationScore: 70,
  minimumQualityScore: 70,
  minimumOriginalityScore: 60,
  agreementTolerance: 15,
};

function audit(actorID: ID, action: string, entityType: string, entityID: ID, clock: () => Date): AuditEvent {
  return {
    id: crypto.randomUUID(),
    actorID,
    action,
    entityType,
    entityID,
    metadata: {},
    createdAt: nowISO(clock),
  };
}

function publicKeyForPublisher(publisher: Publisher, publicKey: string): PublisherSigningKey | undefined {
  return publisher.signingKeys.find((key) => key.publicKey === publicKey && !key.revokedAt);
}

function reviewScoresAgree(left: ReviewReport, right: ReviewReport, tolerance: number): boolean {
  return Math.abs(left.usefulnessScore - right.usefulnessScore) <= tolerance
    && Math.abs(left.integrationScore - right.integrationScore) <= tolerance
    && Math.abs(left.qualityScore - right.qualityScore) <= tolerance
    && Math.abs(left.originalityScore - right.originalityScore) <= tolerance;
}

function reviewPasses(report: ReviewReport, policy: ReviewPolicy): boolean {
  return report.recommendedDecision === "approve"
    && report.flags.length === 0
    && report.capabilityRisk !== "high"
    && report.capabilityRisk !== "sensitive"
    && report.usefulnessScore >= policy.minimumUsefulnessScore
    && report.integrationScore >= policy.minimumIntegrationScore
    && report.qualityScore >= policy.minimumQualityScore
    && report.originalityScore >= policy.minimumOriginalityScore;
}

function submissionStatusForRelease(release: Release): Submission["status"] {
  if (release.status === "published") return "published";
  if (release.status === "approved") return "approved";
  if (release.status === "rejected") return "rejected";
  if (release.status === "quarantined" || release.status === "revoked") return "quarantined";
  return release.reviewStatus === "escalated" ? "needs-human-review" : "under-review";
}

export class PublishingService {
  private readonly policy: ReviewPolicy;
  private readonly clock: () => Date;
  private readonly rateLimiter: SubmissionRateLimiter;
  public constructor(
    private readonly store: MarketplaceStore,
    private readonly artifacts: ArtifactStore,
    private readonly reviewers: readonly [ReviewProvider, ReviewProvider],
    policy: Partial<ReviewPolicy> = {},
    clock: () => Date = () => new Date(),
    rateLimiter: SubmissionRateLimiter = new FixedWindowSubmissionRateLimiter(),
  ) {
    this.policy = { ...DEFAULT_REVIEW_POLICY, ...policy };
    this.clock = clock;
    this.rateLimiter = rateLimiter;
    if (reviewers[0].reviewerID === reviewers[1].reviewerID) throw new Error("Publishing requires two independent reviewers.");
  }

  public async registerPublisher(input: Omit<Publisher, "createdAt" | "updatedAt">, actorID: ID): Promise<Publisher> {
    const publishers = await this.store.listPublishers();
    if (publishers.some((publisher) => publisher.username === input.username && publisher.id !== input.id)) throw new Error("Publisher username is already in use.");
    const timestamp = nowISO(this.clock);
    const publisher: Publisher = { ...structuredClone(input), createdAt: timestamp, updatedAt: timestamp };
    if (publisher.signingKeys.some((key) => key.revokedAt && key.revokedAt < key.createdAt)) throw new Error("Signing key revocation cannot precede key creation.");
    await this.store.savePublisher(publisher);
    await this.store.appendAuditEvent(audit(actorID, "publisher.created", "publisher", publisher.id, this.clock));
    return publisher;
  }

  public async rotatePublisherKey(publisherID: ID, key: PublisherSigningKey, actorID: ID): Promise<Publisher> {
    const publisher = await this.store.getPublisher(publisherID);
    if (!publisher) throw new Error("Publisher not found.");
    if (publisher.signingKeys.some((existing) => existing.keyID === key.keyID)) throw new Error("Signing key ID already exists.");
    const updated: Publisher = { ...publisher, signingKeys: [...publisher.signingKeys, key], updatedAt: nowISO(this.clock) };
    await this.store.savePublisher(updated);
    await this.store.appendAuditEvent(audit(actorID, "publisher.signing-key-added", "publisher", publisherID, this.clock));
    return updated;
  }

  public async createProduct(input: ProductInput, actorID: ID): Promise<Product> {
    const publisher = await this.requirePublisher(input.publisherID);
    this.assertPublisherCanPublish(publisher);
    if (await this.store.getProduct(input.id)) throw new Error("Product ID already exists.");
    const timestamp = nowISO(this.clock);
    const product: Product = {
      ...input,
      screenshots: input.screenshots ?? [],
      supportedHostIDs: [],
      componentIDs: [],
      tags: input.tags ?? [],
      publicationStatus: "draft",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    assertPublicMetadataSafe(product);
    await this.store.saveProduct(product);
    await this.store.appendAuditEvent(audit(actorID, "product.created", "product", product.id, this.clock));
    return product;
  }

  public async createComponent(input: ComponentInput, actorID: ID): Promise<HostComponent> {
    const product = await this.store.getProduct(input.productID);
    if (!product) throw new Error("Product not found.");
    const publisher = await this.requirePublisher(product.publisherID);
    this.assertPublisherCanPublish(publisher);
    if (!await this.store.getHost(input.hostID)) throw new Error("Host not found.");
    if (await this.store.getComponent(input.id)) throw new Error("Component ID already exists.");
    const component: HostComponent = {
      ...input,
      widgetIDs: [],
      releaseChannel: input.releaseChannel ?? "stable",
    };
    await this.store.saveComponent(component);
    await this.store.saveProduct({
      ...product,
      supportedHostIDs: [...new Set([...product.supportedHostIDs, component.hostID])].sort(),
      componentIDs: [...product.componentIDs, component.id],
      updatedAt: nowISO(this.clock),
    });
    await this.store.appendAuditEvent(audit(actorID, "component.created", "component", component.id, this.clock));
    return component;
  }

  public async createWidget(input: WidgetInput, actorID: ID): Promise<Widget> {
    const component = await this.store.getComponent(input.componentID);
    if (!component) throw new Error("Component not found.");
    const product = await this.store.getProduct(component.productID);
    if (!product) throw new Error("Product not found.");
    const publisher = await this.requirePublisher(product.publisherID);
    this.assertPublisherCanPublish(publisher);
    if (await this.store.getWidget(input.id)) throw new Error("Widget ID already exists.");
    const widget: Widget = { ...structuredClone(input), available: input.available ?? true };
    assertPublicMetadataSafe(widget);
    await this.store.saveWidget(widget);
    await this.store.saveComponent({ ...component, widgetIDs: [...component.widgetIDs, widget.id] });
    await this.store.appendAuditEvent(audit(actorID, "widget.created", "widget", widget.id, this.clock));
    return widget;
  }

  public async submitDirectory(input: DirectorySubmissionInput): Promise<SubmissionResult> {
    return this.submit({ ...input, files: await loadPackageDirectory(input.packageRoot) });
  }

  public async submit(input: SubmissionInput): Promise<SubmissionResult> {
    const publisher = await this.requirePublisher(input.publisherID);
    const product = await this.store.getProduct(input.productID);
    const component = await this.store.getComponent(input.componentID);
    if (!product || product.publisherID !== publisher.id) throw new Error("Publisher does not own the selected product.");
    if (!component || component.productID !== product.id) throw new Error("Component does not belong to the selected product.");
    this.assertPublisherCanPublish(publisher);
    if (!isSemver(input.version)) throw new Error("Release version must use semantic versioning.");
    if (!await this.rateLimiter.allow(publisher.id, this.clock())) throw new SubmissionRateLimitError();
    const previousVersions = await this.store.listReleases(component.id);
    if (previousVersions.some((release) => release.version === input.version)) throw new SubmissionConflictError("A release with this version already exists for the component.");
    const timestamp = nowISO(this.clock);
    let submission: Submission = {
      id: crypto.randomUUID(),
      publisherID: publisher.id,
      productID: product.id,
      componentID: component.id,
      version: input.version,
      releaseNotes: input.releaseNotes,
      status: "validating",
      validationErrors: [],
      reviewReports: [],
      humanDecisions: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.store.saveSubmission(submission);
    await this.store.appendAuditEvent(audit(input.actorID, "submission.started", "submission", submission.id, this.clock));
    const validation = await validatePackageFiles(input.files, {
      expectedPublisherID: publisher.id,
      expectedHostID: component.hostID,
      expectedComponent: component,
      requireSignature: true,
      expectedReleaseVersion: input.version,
      trustedPublicKeys: publisher.signingKeys.filter((key) => !key.revokedAt).map((key) => key.publicKey),
    });
    if (!validation.ok || !validation.envelope || !validation.files || !validation.packageDigest || !validation.binaryDigest || !validation.verifiedPublicKey) {
      submission = { ...submission, status: "rejected", validationErrors: validation.errors, updatedAt: nowISO(this.clock) };
      await this.store.saveSubmission(submission);
      await this.store.appendAuditEvent(audit(input.actorID, "submission.validation-rejected", "submission", submission.id, this.clock));
      return { submission, validation };
    }
    const signingKey = publicKeyForPublisher(publisher, validation.verifiedPublicKey);
    if (!signingKey) throw new Error("Validated signing key is not registered to the publisher.");
    const artifact = await this.artifacts.putBundle(validation.files, validation.packageDigest, {
      binaryName: validation.envelope.binaryName,
      binaryDigest: validation.binaryDigest,
    });
    const releaseID = crypto.randomUUID();
    const release: Release = {
      id: releaseID,
      componentID: component.id,
      version: input.version,
      releaseNotes: input.releaseNotes,
      artifact,
      signature: {
        algorithm: "Ed25519",
        keyID: signingKey.keyID,
        publicKey: signingKey.publicKey,
        signature: validation.envelope.signature ?? "",
        verified: true,
        verifiedAt: nowISO(this.clock),
      },
      compatibility: {
        hostID: component.hostID,
        packageFormat: component.packageFormat,
        hostVersion: { minimum: component.minimumHostVersion },
        sdkVersion: { minimum: component.minimumSDKVersion },
        platformVersion: component.supportedPlatform,
      },
      capabilityDiff: component.capabilities,
      reviewStatus: "in-progress",
      status: "under-review",
      createdAt: timestamp,
      updatedAt: nowISO(this.clock),
    };
    await this.store.saveRelease(release);
    submission = { ...submission, releaseID, status: "under-review", updatedAt: nowISO(this.clock) };
    await this.store.saveSubmission(submission);
    const reviewInput: ReviewInput = {
      releaseID,
      publisher: { id: publisher.id, username: publisher.username, displayName: publisher.displayName },
      product: {
        id: product.id,
        name: product.name,
        shortDescription: product.shortDescription,
        tags: product.tags,
        licenseIdentifier: product.licenseIdentifier,
        sourceRepositoryURL: product.sourceRepositoryURL,
      },
      component: {
        id: component.id,
        hostID: component.hostID,
        bridgeID: component.bridgeID,
        packageFormat: component.packageFormat,
        capabilities: component.capabilities,
      },
      manifest: validation.envelope.manifest,
      releaseVersion: input.version,
      releaseNotes: input.releaseNotes,
    };
    let reports: ReviewReport[] = [];
    try {
      reports = await Promise.all(this.reviewers.map(async (reviewer) => {
        const report = await reviewer.review(reviewInput);
        return {
          ...report,
          reviewerID: reviewer.reviewerID,
          modelID: reviewer.modelID,
          promptVersion: reviewer.promptVersion,
          createdAt: nowISO(this.clock),
        };
      }));
    } catch {
      reports = [];
      release.reviewStatus = "escalated";
    }
    submission = { ...submission, reviewReports: reports, updatedAt: nowISO(this.clock) };
    const reviewedRelease = { ...release, reviewStatus: reports.length === 2 ? "passed" : "escalated", status: reports.length === 2 ? "approved" : "under-review", updatedAt: nowISO(this.clock) } as Release;
    if (reports.length === 2) {
      const firstReport = reports[0];
      const secondReport = reports[1];
      if (!firstReport || !secondReport) throw new Error("Review pipeline returned an incomplete reviewer set.");
      const agreement = reviewScoresAgree(firstReport, secondReport, this.policy.agreementTolerance);
      const anyEscalation = reports.some((report) => report.recommendedDecision === "escalate" || report.capabilityRisk === "high" || report.capabilityRisk === "sensitive");
      const allPass = reports.every((report) => reviewPasses(report, this.policy));
      if (allPass && agreement && !anyEscalation) {
        reviewedRelease.reviewStatus = "passed";
        reviewedRelease.status = "approved";
      } else if (reports.some((report) => report.recommendedDecision === "reject") && agreement && !anyEscalation) {
        reviewedRelease.reviewStatus = "rejected";
        reviewedRelease.status = "rejected";
      } else {
        reviewedRelease.reviewStatus = "escalated";
        reviewedRelease.status = "under-review";
      }
    }
    await this.store.saveRelease(reviewedRelease);
    submission = { ...submission, status: submissionStatusForRelease(reviewedRelease), updatedAt: nowISO(this.clock) };
    await this.store.saveSubmission(submission);
    await this.store.appendAuditEvent(audit(input.actorID, "submission.reviewed", "submission", submission.id, this.clock));
    return { submission, validation };
  }

  public async publish(releaseID: ID, actorID: ID): Promise<Release> {
    return this.store.transaction(async (store) => {
      const release = await store.getRelease(releaseID);
      if (!release) throw new Error("Release not found.");
      if (release.status !== "approved" || release.reviewStatus !== "passed") throw new Error("Only an approved release can be published.");
      const component = await store.getComponent(release.componentID);
      if (!component) throw new Error("Component not found.");
      const publishedAt = nowISO(this.clock);
      const existing = (await store.listReleases(component.id)).find((candidate) => candidate.status === "published");
      if (existing && existing.id !== release.id) await store.saveRelease({ ...existing, status: "superseded", updatedAt: publishedAt });
      const published = { ...release, status: "published", publishedAt, updatedAt: publishedAt } as Release;
      await store.saveRelease(published);
      await store.saveComponent({ ...component, currentReleaseID: release.id });
      const submissions = await store.listSubmissions();
      const submission = submissions.find((candidate) => candidate.releaseID === release.id);
      if (submission) await store.saveSubmission({ ...submission, status: "published", updatedAt: publishedAt });
      await store.appendAuditEvent(audit(actorID, "release.published", "release", release.id, this.clock));
      return published;
    });
  }

  public async decideHuman(releaseID: ID, decision: HumanDecision): Promise<Release> {
    return this.store.transaction(async (store) => {
      const release = await store.getRelease(releaseID);
      if (!release) throw new Error("Release not found.");
      if (release.status === "published" && decision.decision !== "quarantine" && decision.decision !== "revoke") throw new Error("Published releases require a quarantine or revoke decision.");
      if (release.status === "rejected" || release.status === "revoked" || release.status === "archived") throw new Error("This release is no longer reviewable.");
      const timestamp = nowISO(this.clock);
      let status: Release["status"] = release.status;
      let reviewStatus: Release["reviewStatus"] = release.reviewStatus;
      if (decision.decision === "approve") {
        status = "approved";
        reviewStatus = "passed";
      } else if (decision.decision === "reject" || decision.decision === "request-changes") {
        status = "rejected";
        reviewStatus = "rejected";
      } else if (decision.decision === "quarantine") {
        status = "quarantined";
        reviewStatus = "escalated";
      } else if (decision.decision === "revoke") {
        status = "revoked";
        reviewStatus = "escalated";
      }
      const updated: Release = {
        ...release,
        status,
        reviewStatus,
        quarantinedAt: decision.decision === "quarantine" ? timestamp : release.quarantinedAt,
        revokedAt: decision.decision === "revoke" ? timestamp : release.revokedAt,
        updatedAt: timestamp,
      };
      await store.saveRelease(updated);
      const submissions = await store.listSubmissions();
      const submission = submissions.find((candidate) => candidate.releaseID === releaseID);
      if (submission) await store.saveSubmission({ ...submission, humanDecisions: [...submission.humanDecisions, decision], status: submissionStatusForRelease(updated), updatedAt: timestamp });
      await store.appendAuditEvent(audit(decision.reviewerID, `release.human-${decision.decision}`, "release", releaseID, this.clock));
      return updated;
    });
  }

  private async requirePublisher(id: ID): Promise<Publisher> {
    const publisher = await this.store.getPublisher(id);
    if (!publisher) throw new Error("Publisher not found.");
    return publisher;
  }

  private assertPublisherCanPublish(publisher: Publisher): void {
    if (publisher.status !== "active") throw new Error("Publisher account is not active.");
    if (!publisher.developerModeEnabled) throw new Error("Developer Mode must be enabled for publishing.");
    if (!publisher.termsAcceptedAt) throw new Error("Publisher terms must be accepted before publishing.");
  }
}
