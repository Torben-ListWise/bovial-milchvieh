import type { Readable } from "stream";

/**
 * Abstraction over a single stored file/object.
 * Implemented by both ReplitStorageFile (GCS-backed) and HetznerStorageFile (S3-backed).
 *
 * getMetadata() returns a normalised shape so objectAcl.ts and other consumers
 * never need to know which backend is active.
 */
export interface IStorageFile {
  /** Full key / object name within its bucket or directory. */
  readonly name: string;

  exists(): Promise<[boolean]>;

  getMetadata(): Promise<[StorageFileMetadata]>;

  /**
   * Merge-update the custom metadata dict.
   * Pass `{ metadata: { key: value } }` — same shape as GCS setMetadata().
   */
  setMetadata(opts: { metadata: Record<string, string> }): Promise<void>;

  createReadStream(): Readable;

  save(buf: Buffer, opts: { contentType: string; resumable?: boolean }): Promise<void>;

  /**
   * Download the entire file as a Buffer.
   * Returns a tuple `[Buffer]` to match the GCS API shape used by existing call sites.
   */
  download(): Promise<[Buffer]>;

  /** Delete the object from storage. */
  delete(): Promise<void>;

  /**
   * Generate a short-lived signed URL for direct client access.
   * Options shape mirrors the GCS File.getSignedUrl() options used in the codebase.
   */
  getSignedUrl(opts: { action: "read" | "write"; expires: number }): Promise<[string]>;
}

export interface StorageFileMetadata {
  contentType?: string;
  /** May be a string (from GCS) or a number (from S3). */
  size?: string | number;
  /** Custom user-defined key→value pairs. */
  metadata?: Record<string, string>;
}

/**
 * Adapter interface implemented by ReplitObjectStorageAdapter and HetznerS3Adapter.
 * ObjectStorageService is a thin facade that delegates to the active adapter.
 */
export interface IObjectStorageAdapter {
  /**
   * Returns an array of fully-qualified storage paths (bucket/prefix) to search
   * for public objects.
   */
  getPublicObjectSearchPaths(): string[];

  /** Returns the fully-qualified storage directory used for private uploads. */
  getPrivateObjectDir(): string;

  /** Finds a public object by relative filePath across the search paths. */
  searchPublicObject(filePath: string): Promise<IStorageFile | null>;

  /** Streams the file as a standard Response object. */
  downloadObject(file: IStorageFile, cacheTtlSec?: number): Promise<Response>;

  /**
   * Creates a presigned PUT URL for a new upload and returns it.
   * The objectPath for the upload can be derived via normalizeObjectEntityPath().
   */
  getObjectEntityUploadURL(): Promise<string>;

  /**
   * Resolves a presigned or raw storage URL/path to the canonical internal
   * `/objects/<key>` form used throughout the app.
   */
  normalizeObjectEntityPath(rawPath: string): string;

  /**
   * Resolves an internal `/objects/<key>` path to an IStorageFile.
   * Throws ObjectNotFoundError when the object does not exist.
   */
  getObjectEntityFile(objectPath: string): Promise<IStorageFile>;

  /**
   * Uploads raw bytes under `<privateObjectDir>/<subpath>` and returns the
   * internal `/objects/<subpath>` path.
   */
  uploadBytesAsEntity(subpath: string, buf: Buffer, contentType: string): Promise<string>;
}
