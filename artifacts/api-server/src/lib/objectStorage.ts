/**
 * ObjectStorageService — public facade for file storage.
 *
 * The active backend is selected by the STORAGE_PROVIDER environment variable:
 *   STORAGE_PROVIDER=replit  → ReplitObjectStorageAdapter (Replit GCS, default)
 *   STORAGE_PROVIDER=hetzner → HetznerS3Adapter (Hetzner Object Storage, S3-compatible)
 *
 * All code that imports from this module continues to work unchanged — the
 * adapter selection is an internal implementation detail.
 */

import type { IObjectStorageAdapter, IStorageFile } from "./storageInterface";
import {
  ObjectAclPolicy,
  ObjectPermission,
  getObjectAclPolicy,
  setObjectAclPolicy,
  canAccessObject,
} from "./objectAcl";

export type { ObjectAclPolicy };
export { ObjectPermission };
export type { IStorageFile };

// ---------------------------------------------------------------------------
// Errors (kept as named exports so existing import sites don't break)
// ---------------------------------------------------------------------------

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectAclConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjectAclConflictError";
    Object.setPrototypeOf(this, ObjectAclConflictError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

function createAdapter(): IObjectStorageAdapter {
  const provider = (process.env.STORAGE_PROVIDER || "replit").toLowerCase();
  if (provider === "hetzner") {
    // Lazy import so the GCS dependency is never touched in Replit mode
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { HetznerS3Adapter } = require("./hetznerS3Adapter") as typeof import("./hetznerS3Adapter");
    return new HetznerS3Adapter();
  }
  // Default: Replit GCS-backed storage
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ReplitObjectStorageAdapter } = require("./replitStorageAdapter") as typeof import("./replitStorageAdapter");
  return new ReplitObjectStorageAdapter();
}

// ---------------------------------------------------------------------------
// ObjectStorageService — thin facade; delegates entirely to the active adapter
// ---------------------------------------------------------------------------

export class ObjectStorageService {
  private readonly adapter: IObjectStorageAdapter;

  constructor() {
    this.adapter = createAdapter();
  }

  // ------------------------------------------------------------------
  // Configuration helpers (kept for backwards-compat with any direct callers)
  // ------------------------------------------------------------------

  getPublicObjectSearchPaths(): string[] {
    return this.adapter.getPublicObjectSearchPaths();
  }

  getPrivateObjectDir(): string {
    return this.adapter.getPrivateObjectDir();
  }

  // ------------------------------------------------------------------
  // Core operations
  // ------------------------------------------------------------------

  async searchPublicObject(filePath: string): Promise<IStorageFile | null> {
    return this.adapter.searchPublicObject(filePath);
  }

  async downloadObject(file: IStorageFile, cacheTtlSec: number = 3600): Promise<Response> {
    return this.adapter.downloadObject(file, cacheTtlSec);
  }

  async getObjectEntityUploadURL(): Promise<string> {
    return this.adapter.getObjectEntityUploadURL();
  }

  normalizeObjectEntityPath(rawPath: string): string {
    return this.adapter.normalizeObjectEntityPath(rawPath);
  }

  async getObjectEntityFile(objectPath: string): Promise<IStorageFile> {
    return this.adapter.getObjectEntityFile(objectPath);
  }

  async uploadBytesAsEntity(
    subpath: string,
    buf: Buffer,
    contentType: string,
  ): Promise<string> {
    return this.adapter.uploadBytesAsEntity(subpath, buf, contentType);
  }

  // ------------------------------------------------------------------
  // ACL helpers (delegate to objectAcl.ts)
  // ------------------------------------------------------------------

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    const existing = await getObjectAclPolicy(objectFile);
    if (existing && existing.owner !== aclPolicy.owner) {
      throw new ObjectAclConflictError("Object already owned by a different user");
    }
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: IStorageFile;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}
