import { lstat, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { HostComponent, ID } from "./domain";
import { isSemver, isValidDigest } from "./domain";
import type { PackageFile } from "./storage";

export interface PackageManifestWidget {
  id: string;
  title: string;
  symbol: string;
  description: string;
  supportedSizes: readonly string[];
  supportedTabs: readonly string[];
  supportsMultipleInstances: boolean;
  supportsMoving: boolean;
  settings: readonly Record<string, unknown>[];
  actions: readonly Record<string, unknown>[];
  ports: readonly Record<string, unknown>[];
  permissions: readonly string[];
  states: readonly Record<string, unknown>[];
  sizeBehaviors: readonly Record<string, unknown>[];
  customization: { options: readonly Record<string, unknown>[] };
  stockRoleID?: string;
  liveActivities?: readonly Record<string, unknown>[];
}

export interface PackageManifest {
  manifestVersion: number;
  id: string;
  publisherID: ID;
  displayName: string;
  version: string;
  minimumSDKVersion: string;
  minimumMacOSMajorVersion: number;
  widgets: readonly PackageManifestWidget[];
}

export interface PackageEnvelope {
  binarySHA256: string;
  manifest: PackageManifest;
  binaryName: string;
  signature?: string;
  publisherPublicKey?: string;
  assets: readonly string[];
}

export interface PackageValidationOptions {
  expectedPublisherID: ID;
  expectedHostID: ID;
  expectedReleaseVersion?: string;
  expectedComponent?: Pick<HostComponent, "hostID" | "packageFormat" | "bridgeID" | "minimumSDKVersion" | "minimumHostVersion">;
  requireSignature: boolean;
  trustedPublicKeys?: readonly string[];
}

export interface PackageValidationResult {
  ok: boolean;
  errors: readonly string[];
  warnings: readonly string[];
  envelope?: PackageEnvelope;
  files?: readonly PackageFile[];
  binaryDigest?: string;
  packageDigest?: string;
  verifiedPublicKey?: string;
}

const SOURCE_FILE_PATTERN = /(?:^|\/)(?:AGENTS\.md|DOCKS\.md|README(?:\.[^/]+)?|\.env(?:\.[^/]+)?|.*\.(?:swift|ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|pem|key|p12|mobileprovision))$/i;
const IMAGE_PATTERN = /^assets\/.+\.(?:png|jpe?g|webp)$/i;
const STANDARD_STATES = new Set(["loading", "ready", "empty", "error", "offline", "permissionDenied", "unavailable", "invalidInput"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, field: string, errors: string[]): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${field} must be a non-empty string.`);
    return false;
  }
  return true;
}

function arrayValue(value: unknown, field: string, errors: string[]): value is readonly unknown[] {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array.`);
    return false;
  }
  return true;
}

export function isSafePackagePath(value: string): boolean {
  return value.length > 0 && !value.startsWith("/") && !value.includes("\\") && !value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..");
}

function decodeBase64(value: string): Uint8Array | undefined {
  try {
    const decoded = atob(value);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

export async function sha256Digest(data: Uint8Array): Promise<string> {
  const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function calculatePackageDigest(files: readonly PackageFile[]): Promise<string> {
  const sorted = [...files].sort((left, right) => left.path.localeCompare(right.path));
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (const file of sorted) {
    const pathBytes = new TextEncoder().encode(`${file.path}\u0000`);
    chunks.push(pathBytes, file.data);
    length += pathBytes.byteLength + file.data.byteLength;
  }
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return sha256Digest(combined);
}

function validateWidget(raw: unknown, index: number, errors: string[]): raw is PackageManifestWidget {
  if (!isRecord(raw)) {
    errors.push(`manifest.widgets[${index}] must be an object.`);
    return false;
  }
  const requiredStrings = ["id", "title", "symbol", "description"] as const;
  for (const field of requiredStrings) stringValue(raw[field], `manifest.widgets[${index}].${field}`, errors);
  for (const field of ["supportedSizes", "supportedTabs", "settings", "actions", "ports", "permissions", "states", "sizeBehaviors"] as const) {
    arrayValue(raw[field], `manifest.widgets[${index}].${field}`, errors);
  }
  if (typeof raw.supportsMultipleInstances !== "boolean") errors.push(`manifest.widgets[${index}].supportsMultipleInstances must be boolean.`);
  if (typeof raw.supportsMoving !== "boolean") errors.push(`manifest.widgets[${index}].supportsMoving must be boolean.`);
  if (!isRecord(raw.customization) || !Array.isArray(raw.customization.options)) errors.push(`manifest.widgets[${index}].customization.options must be an array.`);
  const states = Array.isArray(raw.states) ? raw.states : [];
  const stateIDs = states.filter(isRecord).map((state) => state.id).filter((id): id is string => typeof id === "string");
  if (stateIDs.length === 0) errors.push(`manifest.widgets[${index}] must declare at least one state.`);
  for (const state of STANDARD_STATES) {
    if (!stateIDs.includes(state)) errors.push(`manifest.widgets[${index}] is missing standard state ${state}.`);
  }
  const sizes = Array.isArray(raw.supportedSizes) ? raw.supportedSizes : [];
  if (sizes.length === 0) errors.push(`manifest.widgets[${index}] must declare at least one supported size.`);
  const settings = Array.isArray(raw.settings) ? raw.settings : [];
  for (const [settingIndex, setting] of settings.entries()) {
    if (!isRecord(setting) || typeof setting.id !== "string" || typeof setting.title !== "string") {
      errors.push(`manifest.widgets[${index}].settings[${settingIndex}] must declare id and title.`);
    }
  }
  return true;
}

function validateEnvelope(raw: unknown, options: PackageValidationOptions): { envelope?: PackageEnvelope; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(raw)) return { errors: ["manifest.json must contain an object."] };
  stringValue(raw.binarySHA256, "binarySHA256", errors);
  stringValue(raw.binaryName, "binaryName", errors);
  if (typeof raw.signature !== "undefined" && typeof raw.signature !== "string") errors.push("signature must be a base64 string when provided.");
  if (typeof raw.publisherPublicKey !== "undefined" && typeof raw.publisherPublicKey !== "string") errors.push("publisherPublicKey must be a base64 string when provided.");
  if (!Array.isArray(raw.assets)) errors.push("assets must be an array.");
  const manifest = raw.manifest;
  if (!isRecord(manifest)) errors.push("manifest must be an object.");
  else {
    if (manifest.manifestVersion !== 1) errors.push("manifest.manifestVersion must be 1.");
    for (const field of ["id", "publisherID", "displayName", "version", "minimumSDKVersion"] as const) stringValue(manifest[field], `manifest.${field}`, errors);
    if (typeof manifest.minimumMacOSMajorVersion !== "number" || !Number.isInteger(manifest.minimumMacOSMajorVersion)) errors.push("manifest.minimumMacOSMajorVersion must be an integer.");
    if (typeof manifest.version === "string" && !isSemver(manifest.version)) errors.push("manifest.version must be semantic versioning.");
    if (options.expectedReleaseVersion && manifest.version !== options.expectedReleaseVersion) errors.push("manifest.version does not match the submitted release version.");
    if (!Array.isArray(manifest.widgets) || manifest.widgets.length === 0) errors.push("manifest.widgets must contain at least one widget.");
    else manifest.widgets.forEach((widget, index) => validateWidget(widget, index, errors));
    if (typeof manifest.publisherID === "string" && manifest.publisherID !== options.expectedPublisherID) errors.push("manifest.publisherID does not match the authenticated publisher.");
  }
  const binaryName = typeof raw.binaryName === "string" ? raw.binaryName : "";
  if (!isSafePackagePath(binaryName) || binaryName.includes("/")) errors.push("binaryName must be a single safe filename.");
  const assets = Array.isArray(raw.assets) ? raw.assets.filter((asset): asset is string => typeof asset === "string") : [];
  if (Array.isArray(raw.assets) && assets.length !== raw.assets.length) errors.push("assets must contain only strings.");
  const assetSet = new Set<string>();
  for (const asset of assets) {
    if (!isSafePackagePath(asset) || !IMAGE_PATTERN.test(asset)) errors.push(`Asset is not an allowed static image path: ${asset}`);
    if (assetSet.has(asset)) errors.push(`Duplicate asset path: ${asset}`);
    assetSet.add(asset);
  }
  if (errors.length > 0 || !isRecord(manifest)) return { errors };
  return {
    errors,
    envelope: {
      binarySHA256: typeof raw.binarySHA256 === "string" ? raw.binarySHA256.toLowerCase() : "",
      manifest: manifest as unknown as PackageManifest,
      binaryName,
      signature: typeof raw.signature === "string" ? raw.signature : undefined,
      publisherPublicKey: typeof raw.publisherPublicKey === "string" ? raw.publisherPublicKey : undefined,
      assets,
    },
  };
}

export function buildSigningPayload(manifest: PackageManifest, binaryName: string, binarySHA256: string, assets: readonly string[]): Uint8Array {
  const fields = [
    String(manifest.manifestVersion),
    manifest.id,
    manifest.publisherID,
    manifest.displayName,
    manifest.version,
    manifest.minimumSDKVersion,
    String(manifest.minimumMacOSMajorVersion),
    binaryName,
    binarySHA256.toLowerCase(),
    [...assets].sort().join(","),
  ];
  for (const widget of [...manifest.widgets].sort((left, right) => left.id.localeCompare(right.id))) {
    fields.push(
      widget.id,
      widget.title,
      widget.symbol,
      widget.description,
      [...widget.supportedSizes].sort().join(","),
      [...widget.supportedTabs].sort().join(","),
      widget.supportsMultipleInstances ? "multiple" : "single",
      widget.supportsMoving ? "moving" : "fixed",
      widget.settings.map((setting) => String(setting.id ?? "")).join(","),
      widget.actions.map((action) => String(action.id ?? "")).join(","),
      widget.ports.map((port) => String(port.id ?? "")).join(","),
      [...widget.permissions].sort().join(","),
      widget.stockRoleID ?? "",
      widget.liveActivities?.map((activity: Record<string, unknown>) => String(activity.id ?? "")).sort().join(",") ?? "",
      widget.sizeBehaviors.map((behavior) => String(behavior.id ?? "")).sort().join(","),
      widget.states.map((state) => String(state.id ?? "")).sort().join(","),
      widget.customization.options.map((option) => String(option.id ?? "")).join(","),
    );
  }
  return new TextEncoder().encode(fields.join("\u001f"));
}

async function verifySignature(envelope: PackageEnvelope, payload: Uint8Array): Promise<boolean> {
  if (!envelope.signature || !envelope.publisherPublicKey) return false;
  const signature = decodeBase64(envelope.signature);
  const publicKey = decodeBase64(envelope.publisherPublicKey);
  if (!signature || !publicKey || publicKey.byteLength !== 32 || signature.byteLength !== 64) return false;
  try {
    const publicKeyBytes = publicKey.buffer.slice(publicKey.byteOffset, publicKey.byteOffset + publicKey.byteLength) as ArrayBuffer;
    const signatureBytes = signature.buffer.slice(signature.byteOffset, signature.byteOffset + signature.byteLength) as ArrayBuffer;
    const payloadBytes = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer;
    const key = await crypto.subtle.importKey("raw", publicKeyBytes, { name: "Ed25519" } as AlgorithmIdentifier, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" } as AlgorithmIdentifier, key, signatureBytes, payloadBytes);
  } catch {
    return false;
  }
}

export async function validatePackageFiles(files: readonly PackageFile[], options: PackageValidationOptions): Promise<PackageValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const normalizedFiles = files.map((file) => ({ path: file.path.replaceAll("\\", "/"), data: file.data }));
  const paths = new Set<string>();
  for (const file of normalizedFiles) {
    if (!isSafePackagePath(file.path)) errors.push(`Unsafe package path: ${file.path}`);
    if (paths.has(file.path)) errors.push(`Duplicate package path: ${file.path}`);
    paths.add(file.path);
    if (SOURCE_FILE_PATTERN.test(file.path)) errors.push(`Source, agent instructions, or secret file is not allowed: ${file.path}`);
  }
  const manifestFile = normalizedFiles.find((file) => file.path === "manifest.json");
  if (!manifestFile) return { ok: false, errors: [...errors, "Package must contain manifest.json."], warnings };
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(new TextDecoder().decode(manifestFile.data));
  } catch {
    return { ok: false, errors: [...errors, "manifest.json is not valid JSON."], warnings };
  }
  const envelopeResult = validateEnvelope(rawManifest, options);
  errors.push(...envelopeResult.errors);
  const envelope = envelopeResult.envelope;
  if (!envelope) return { ok: false, errors, warnings };
  if (!isValidDigest(envelope.binarySHA256)) errors.push("binarySHA256 must be a 64-character SHA-256 digest.");
  const binaryFile = normalizedFiles.find((file) => file.path === envelope.binaryName);
  if (!binaryFile) errors.push(`Declared binary is missing: ${envelope.binaryName}`);
  const expectedPaths = new Set(["manifest.json", envelope.binaryName, ...envelope.assets]);
  for (const path of paths) if (!expectedPaths.has(path)) errors.push(`Unexpected package file: ${path}`);
  for (const asset of envelope.assets) if (!paths.has(asset)) errors.push(`Declared asset is missing: ${asset}`);
  if (options.expectedComponent) {
    const component = options.expectedComponent;
    if (component.hostID !== options.expectedHostID) errors.push("Submission component host does not match the selected host.");
    if (component.bridgeID !== envelope.manifest.id) errors.push("Manifest bridge ID does not match the component.");
    if (!isSemver(envelope.manifest.minimumSDKVersion) || !isSemver(component.minimumSDKVersion) || envelope.manifest.minimumSDKVersion !== component.minimumSDKVersion) {
      errors.push("Manifest minimum SDK version does not match the component contract.");
    }
  }
  let binaryDigest: string | undefined;
  if (binaryFile) {
    binaryDigest = await sha256Digest(binaryFile.data);
    if (binaryDigest !== envelope.binarySHA256) errors.push("Declared binary digest does not match downloaded binary bytes.");
  }
  let verifiedPublicKey: string | undefined;
  if (options.requireSignature) {
    if (!envelope.signature || !envelope.publisherPublicKey) errors.push("Marketplace packages must include a signature and publisher public key.");
    else if (!(await verifySignature(envelope, buildSigningPayload(envelope.manifest, envelope.binaryName, envelope.binarySHA256, envelope.assets)))) errors.push("Publisher signature is invalid.");
    else {
      verifiedPublicKey = envelope.publisherPublicKey;
      if (options.trustedPublicKeys && !options.trustedPublicKeys.includes(envelope.publisherPublicKey)) errors.push("Publisher signing key is not trusted for this account.");
    }
  } else if (envelope.signature || envelope.publisherPublicKey) {
    warnings.push("Unsigned local development is allowed, but this package cannot be published without trusted signing.");
  }
  const digest = errors.length === 0 ? await calculatePackageDigest(normalizedFiles) : undefined;
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    envelope,
    files: normalizedFiles,
    binaryDigest,
    packageDigest: digest,
    verifiedPublicKey,
  };
}

export async function loadPackageDirectory(rootPath: string): Promise<readonly PackageFile[]> {
  const root = await lstat(rootPath);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error("Marketplace package root must be a real directory.");
  const files: PackageFile[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const relativePath = relative(rootPath, absolute).replaceAll("\\", "/");
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in packages: ${relativePath}`);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push({ path: relativePath, data: new Uint8Array(await Bun.file(absolute).arrayBuffer()) });
      else throw new Error(`Unsupported package filesystem entry: ${relativePath}`);
    }
  };
  await visit(rootPath);
  return files;
}
