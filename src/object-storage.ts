import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { isValidDigest, type ArtifactRecord } from "./domain";
import type { ArtifactStore, PackageFile } from "./storage";
import { calculatePackageDigest, isSafePackagePath, sha256Digest } from "./validation";

export interface ObjectStorageObject {
  sizeBytes: number;
  metadata: Readonly<Record<string, string>>;
}

export interface ObjectStorageTransport {
  putObjectIfAbsent(key: string, data: Uint8Array, metadata: Readonly<Record<string, string>>): Promise<boolean>;
  headObject(key: string): Promise<ObjectStorageObject | undefined>;
  getObject(key: string): Promise<Uint8Array>;
  listObjectKeys(prefix: string): Promise<readonly string[]>;
}

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyID: string;
  secretAccessKey: string;
  sessionToken?: string;
  forcePathStyle: boolean;
}

function requiredEnvironmentValue(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for S3 configuration.`);
  return value;
}

export function s3ConfigFromEnvironment(env: Record<string, string | undefined> = Bun.env): S3Config {
  const forcePathStyleValue = env.S3_FORCE_PATH_STYLE?.trim();
  let forcePathStyle = true;
  if (forcePathStyleValue !== undefined) {
    if (forcePathStyleValue === "true") forcePathStyle = true;
    else if (forcePathStyleValue === "false") forcePathStyle = false;
    else throw new Error("S3_FORCE_PATH_STYLE must be true or false.");
  }
  return {
    endpoint: requiredEnvironmentValue(env, "S3_ENDPOINT"),
    region: requiredEnvironmentValue(env, "S3_REGION"),
    bucket: requiredEnvironmentValue(env, "S3_BUCKET"),
    accessKeyID: requiredEnvironmentValue(env, "S3_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnvironmentValue(env, "S3_SECRET_ACCESS_KEY"),
    sessionToken: env.S3_SESSION_TOKEN?.trim() || undefined,
    forcePathStyle,
  };
}

function statusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("$metadata" in error)) return undefined;
  const metadata = error.$metadata;
  if (typeof metadata !== "object" || metadata === null || !("httpStatusCode" in metadata)) return undefined;
  return typeof metadata.httpStatusCode === "number" ? metadata.httpStatusCode : undefined;
}

function errorName(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "name" in error && typeof error.name === "string" ? error.name : undefined;
}

function isMissingObject(error: unknown): boolean {
  const name = errorName(error);
  return statusCode(error) === 404 || name === "NotFound" || name === "NoSuchKey";
}

function isPreconditionFailure(error: unknown): boolean {
  const name = errorName(error);
  return statusCode(error) === 412 || name === "PreconditionFailed" || name === "PreconditionFailedError";
}

async function readObjectBody(body: unknown): Promise<Uint8Array> {
  if (body === undefined || body === null) throw new Error("S3 object response did not include a body.");
  if (typeof body === "object" && "transformToByteArray" in body && typeof body.transformToByteArray === "function") {
    return body.transformToByteArray();
  }
  if (body instanceof Uint8Array) return body;
  if (typeof Blob !== "undefined" && body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (typeof body === "object" && body !== null && Symbol.asyncIterator in body) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array | ArrayBuffer>) {
      chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
    }
    const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }
  throw new Error("S3 object response body format is unsupported.");
}

export class S3ObjectStorageTransport implements ObjectStorageTransport {
  public constructor(private readonly client: S3Client, private readonly bucket: string) {}

  public async putObjectIfAbsent(key: string, data: Uint8Array, metadata: Readonly<Record<string, string>>): Promise<boolean> {
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, Metadata: { ...metadata }, IfNoneMatch: "*" }));
      return true;
    } catch (error) {
      if (isPreconditionFailure(error)) return false;
      throw error;
    }
  }

  public async headObject(key: string): Promise<ObjectStorageObject | undefined> {
    try {
      const response = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      if (typeof response.ContentLength !== "number") throw new Error("S3 HEAD response did not include object size.");
      return { sizeBytes: response.ContentLength, metadata: response.Metadata ?? {} };
    } catch (error) {
      if (isMissingObject(error)) return undefined;
      throw error;
    }
  }

  public async getObject(key: string): Promise<Uint8Array> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return readObjectBody(response.Body);
  }

  public async listObjectKeys(prefix: string): Promise<readonly string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: continuationToken }));
      for (const object of response.Contents ?? []) if (object.Key) keys.push(object.Key);
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    return keys;
  }
}

export function createS3ObjectStorageTransport(config: S3Config = s3ConfigFromEnvironment()): S3ObjectStorageTransport {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyID,
      secretAccessKey: config.secretAccessKey,
      ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
    },
  });
  return new S3ObjectStorageTransport(client, config.bucket);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function integrityError(message: string): Error {
  return new Error(`Artifact integrity check failed: ${message}`);
}

export class S3ArtifactStore implements ArtifactStore {
  public constructor(private readonly transport: ObjectStorageTransport, private readonly keyPrefix = "") {}

  public async putBundle(files: readonly PackageFile[], digest: string, metadata: Pick<ArtifactRecord, "binaryName" | "binaryDigest">): Promise<ArtifactRecord> {
    await this.validateBundle(files, digest, metadata);
    const markerKey = this.objectKey(digest, "manifest.json");
    const marker = await this.transport.headObject(markerKey);
    if (marker) return this.existingArtifact(digest, metadata, marker.metadata);

    const orderedFiles = [...files].sort((left, right) => (left.path === "manifest.json" ? 1 : right.path === "manifest.json" ? -1 : left.path.localeCompare(right.path)));
    for (const file of orderedFiles) {
      const isMarker = file.path === "manifest.json";
      const created = await this.transport.putObjectIfAbsent(this.objectKey(digest, file.path), file.data, isMarker ? {
        digest,
        binaryName: metadata.binaryName,
        binaryDigest: metadata.binaryDigest,
      } : {});
      if (!created) {
        const existing = await this.transport.getObject(this.objectKey(digest, file.path));
        if (!bytesEqual(existing, file.data)) throw integrityError(`immutable object differs for ${file.path}.`);
      }
    }
    return this.artifactRecord(digest, files, metadata);
  }

  public async readBundle(digest: string): Promise<readonly PackageFile[]> {
    if (!isValidDigest(digest)) throw integrityError("digest must be a 64-character hexadecimal SHA-256 value.");
    const prefix = this.objectKey(digest, "");
    const keys = await this.transport.listObjectKeys(prefix);
    const files: PackageFile[] = [];
    for (const key of keys) {
      if (!key.startsWith(prefix)) throw integrityError(`object key is outside the requested bundle: ${key}.`);
      const path = key.slice(prefix.length);
      if (!isSafePackagePath(path) || path !== path.replaceAll("\\", "/")) throw integrityError(`stored object path is unsafe: ${path}.`);
      files.push({ path, data: await this.transport.getObject(key) });
    }
    return files.sort((left, right) => left.path.localeCompare(right.path));
  }

  public async hasBundle(digest: string): Promise<boolean> {
    if (!isValidDigest(digest)) return false;
    return (await this.transport.headObject(this.objectKey(digest, "manifest.json"))) !== undefined;
  }

  private objectKey(digest: string, path: string): string {
    const prefix = this.keyPrefix.replace(/\/+$/, "");
    return `${prefix ? `${prefix}/` : ""}sha256/${digest}/${path}`;
  }

  private async validateBundle(files: readonly PackageFile[], digest: string, metadata: Pick<ArtifactRecord, "binaryName" | "binaryDigest">): Promise<void> {
    if (!isValidDigest(digest)) throw integrityError("digest must be a 64-character hexadecimal SHA-256 value.");
    const paths = new Set<string>();
    for (const file of files) {
      if (file.path !== file.path.replaceAll("\\", "/") || !isSafePackagePath(file.path)) throw integrityError(`unsafe or non-normalized package path: ${file.path}.`);
      if (paths.has(file.path)) throw integrityError(`duplicate package path: ${file.path}.`);
      paths.add(file.path);
    }
    if (!paths.has("manifest.json")) throw integrityError("manifest.json is required.");
    if (metadata.binaryName.length === 0 || !paths.has(metadata.binaryName)) throw integrityError("binaryName must name a package file.");
    if (!isValidDigest(metadata.binaryDigest)) throw integrityError("binaryDigest must be a 64-character hexadecimal SHA-256 value.");
    const actualDigest = await calculatePackageDigest(files);
    if (actualDigest !== digest) throw integrityError("package digest does not match the content-addressed key.");
    const binary = files.find((file) => file.path === metadata.binaryName);
    if (!binary || await sha256Digest(binary.data) !== metadata.binaryDigest) throw integrityError("binary digest does not match the package content.");
  }

  private async existingArtifact(digest: string, requestedMetadata: Pick<ArtifactRecord, "binaryName" | "binaryDigest">, markerMetadata: Readonly<Record<string, string>>): Promise<ArtifactRecord> {
    const files = await this.readBundle(digest);
    const storedMetadata = {
      binaryName: markerMetadata.binaryName ?? requestedMetadata.binaryName,
      binaryDigest: markerMetadata.binaryDigest ?? requestedMetadata.binaryDigest,
    };
    return this.artifactRecord(digest, files, storedMetadata);
  }

  private async artifactRecord(digest: string, files: readonly PackageFile[], metadata: Pick<ArtifactRecord, "binaryName" | "binaryDigest">): Promise<ArtifactRecord> {
    const actualDigest = await calculatePackageDigest(files);
    if (actualDigest !== digest) throw integrityError("stored package digest does not match its content-addressed key.");
    const binary = files.find((file) => file.path === metadata.binaryName);
    if (!binary || await sha256Digest(binary.data) !== metadata.binaryDigest) throw integrityError("stored binary digest does not match its content.");
    return {
      digest,
      objectKey: `sha256/${digest}`,
      sizeBytes: files.reduce((total, file) => total + file.data.byteLength, 0),
      contentType: "application/vnd.tosh.notchbridge",
      fileCount: files.length,
      binaryName: metadata.binaryName,
      binaryDigest: metadata.binaryDigest,
      immutable: true,
    };
  }
}
