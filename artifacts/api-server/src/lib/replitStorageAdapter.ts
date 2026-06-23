import { Storage } from "@google-cloud/storage";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import type { IObjectStorageAdapter, IStorageFile, StorageFileMetadata } from "./storageInterface";
import { ObjectNotFoundError } from "./objectStorage";

// ---------------------------------------------------------------------------
// Replit sidecar GCS client
// ---------------------------------------------------------------------------

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const gcsClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

// ---------------------------------------------------------------------------
// ReplitStorageFile — wraps a GCS File
// ---------------------------------------------------------------------------

export class ReplitStorageFile implements IStorageFile {
  constructor(private readonly gcsFile: import("@google-cloud/storage").File) {}

  get name(): string {
    return this.gcsFile.name;
  }

  async exists(): Promise<[boolean]> {
    return this.gcsFile.exists();
  }

  async getMetadata(): Promise<[StorageFileMetadata]> {
    const [raw] = await this.gcsFile.getMetadata();
    const normalized: StorageFileMetadata = {
      contentType: raw.contentType as string | undefined,
      size: raw.size as string | number | undefined,
      metadata: raw.metadata as Record<string, string> | undefined,
    };
    return [normalized];
  }

  async setMetadata(opts: { metadata: Record<string, string> }): Promise<void> {
    await this.gcsFile.setMetadata({ metadata: opts.metadata });
  }

  createReadStream(): Readable {
    return this.gcsFile.createReadStream();
  }

  async save(buf: Buffer, opts: { contentType: string; resumable?: boolean }): Promise<void> {
    await this.gcsFile.save(buf, { contentType: opts.contentType, resumable: opts.resumable ?? false });
  }

  async download(): Promise<[Buffer]> {
    const [buf] = await this.gcsFile.download();
    return [buf];
  }

  async delete(): Promise<void> {
    await this.gcsFile.delete();
  }

  async getSignedUrl(opts: { action: "read" | "write"; expires: number }): Promise<[string]> {
    const [url] = await this.gcsFile.getSignedUrl({
      action: opts.action,
      expires: opts.expires,
    });
    return [url];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const parts = path.split("/");
  if (parts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

async function signGcsUrl({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign GCS URL, status: ${response.status}. Make sure you're running on Replit.`
    );
  }
  const { signed_url: signedURL } = (await response.json()) as { signed_url: string };
  return signedURL;
}

// ---------------------------------------------------------------------------
// ReplitObjectStorageAdapter
// ---------------------------------------------------------------------------

export class ReplitObjectStorageAdapter implements IObjectStorageAdapter {
  getPublicObjectSearchPaths(): string[] {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<IStorageFile | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = gcsClient.bucket(bucketName);
      const file = bucket.file(objectName);
      const [exists] = await file.exists();
      if (exists) {
        return new ReplitStorageFile(file);
      }
    }
    return null;
  }

  async downloadObject(file: IStorageFile, cacheTtlSec: number = 3600): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclMeta = metadata.metadata?.["aclPolicy"];
    const isPublic = aclMeta ? (JSON.parse(aclMeta) as { visibility?: string }).visibility === "public" : false;

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": metadata.contentType || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    return signGcsUrl({ bucketName, objectName, method: "PUT", ttlSec: 900 });
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }
    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    if (!rawObjectPath.startsWith(entityDir)) {
      return rawObjectPath;
    }
    const entityId = rawObjectPath.slice(entityDir.length);
    return `/objects/${entityId}`;
  }

  async getObjectEntityFile(objectPath: string): Promise<IStorageFile> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }
    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = gcsClient.bucket(bucketName);
    const gcsFile = bucket.file(objectName);
    const [exists] = await gcsFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return new ReplitStorageFile(gcsFile);
  }

  async uploadBytesAsEntity(subpath: string, buf: Buffer, contentType: string): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const dir = privateObjectDir.endsWith("/") ? privateObjectDir : `${privateObjectDir}/`;
    const fullPath = `${dir}${subpath}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const bucket = gcsClient.bucket(bucketName);
    const file = bucket.file(objectName);
    await file.save(buf, { contentType, resumable: false });
    return `/objects/${subpath}`;
  }
}
