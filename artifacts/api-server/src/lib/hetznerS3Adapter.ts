import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import type { IObjectStorageAdapter, IStorageFile, StorageFileMetadata } from "./storageInterface";
import { ObjectNotFoundError } from "./objectStorage";

// ---------------------------------------------------------------------------
// Hetzner S3 client factory
// ---------------------------------------------------------------------------

function buildS3Client(): S3Client {
  const endpoint = process.env.HETZNER_S3_ENDPOINT;
  const accessKeyId = process.env.HETZNER_S3_ACCESS_KEY;
  const secretAccessKey = process.env.HETZNER_S3_SECRET_KEY;
  const region = process.env.HETZNER_S3_REGION || "eu-central-1";

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Hetzner S3 is not configured. Set HETZNER_S3_ENDPOINT, " +
        "HETZNER_S3_ACCESS_KEY, and HETZNER_S3_SECRET_KEY environment variables."
    );
  }

  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

function getBucket(): string {
  const bucket = process.env.HETZNER_S3_BUCKET;
  if (!bucket) {
    throw new Error("HETZNER_S3_BUCKET environment variable is not set.");
  }
  return bucket;
}

// ---------------------------------------------------------------------------
// HetznerStorageFile — wraps an S3 object key
// ---------------------------------------------------------------------------

export class HetznerStorageFile implements IStorageFile {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    readonly name: string,
  ) {}

  async exists(): Promise<[boolean]> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.name }));
      return [true];
    } catch (err: any) {
      if (err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404) {
        return [false];
      }
      throw err;
    }
  }

  async getMetadata(): Promise<[StorageFileMetadata]> {
    const head = await this.s3.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: this.name })
    );
    const normalized: StorageFileMetadata = {
      contentType: head.ContentType,
      size: head.ContentLength,
      // S3 user metadata comes back in head.Metadata (already lowercased by SDK)
      metadata: head.Metadata as Record<string, string> | undefined,
    };
    return [normalized];
  }

  async setMetadata(opts: { metadata: Record<string, string> }): Promise<void> {
    // S3 has no in-place metadata update — must copy object to itself with new metadata.
    // First, load existing metadata so we don't lose other keys.
    const [existing] = await this.getMetadata();
    const merged = { ...(existing.metadata ?? {}), ...opts.metadata };

    await this.s3.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${this.name}`,
        Key: this.name,
        ContentType: existing.contentType,
        Metadata: merged,
        MetadataDirective: "REPLACE",
      })
    );
  }

  createReadStream(): Readable {
    // GetObjectCommand returns a stream; we wrap it via an async generator so
    // the command isn't sent until the stream is actually consumed.
    const s3 = this.s3;
    const bucket = this.bucket;
    const key = this.name;

    const pass = new Readable({ read() {} });

    s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      .then((output) => {
        const body = output.Body;
        if (!body) {
          pass.push(null);
          return;
        }
        // AWS SDK v3 Body is a SdkStreamMixin | Readable-like
        if (typeof (body as any).pipe === "function") {
          (body as NodeJS.ReadableStream).pipe(
            new (require("stream").Writable)({
              write(chunk: any, _enc: any, cb: () => void) {
                pass.push(chunk);
                cb();
              },
              final(cb: () => void) {
                pass.push(null);
                cb();
              },
            })
          );
        } else {
          // Fallback: collect chunks via async iteration
          (async () => {
            for await (const chunk of body as AsyncIterable<Uint8Array>) {
              pass.push(Buffer.from(chunk));
            }
            pass.push(null);
          })().catch((err) => pass.destroy(err));
        }
      })
      .catch((err) => pass.destroy(err));

    return pass;
  }

  async save(buf: Buffer, opts: { contentType: string; resumable?: boolean }): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.name,
        Body: buf,
        ContentType: opts.contentType,
      })
    );
  }

  async download(): Promise<[Buffer]> {
    const output = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.name })
    );
    const chunks: Uint8Array[] = [];
    for await (const chunk of output.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return [Buffer.concat(chunks)];
  }

  async delete(): Promise<void> {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.name }));
  }

  async getSignedUrl(opts: { action: "read" | "write"; expires: number }): Promise<[string]> {
    const ttlSec = Math.max(1, Math.round((opts.expires - Date.now()) / 1000));
    if (opts.action === "write") {
      const cmd = new PutObjectCommand({ Bucket: this.bucket, Key: this.name });
      const url = await getSignedUrl(this.s3, cmd, { expiresIn: ttlSec });
      return [url];
    }
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: this.name });
    const url = await getSignedUrl(this.s3, cmd, { expiresIn: ttlSec });
    return [url];
  }
}

// ---------------------------------------------------------------------------
// HetznerS3Adapter
// ---------------------------------------------------------------------------

export class HetznerS3Adapter implements IObjectStorageAdapter {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor() {
    this.s3 = buildS3Client();
    this.bucket = getBucket();
  }

  // Hetzner does not use a path-based public search concept like GCS buckets;
  // return an empty array — public serving should use a CDN or separate bucket.
  getPublicObjectSearchPaths(): string[] {
    return [];
  }

  getPrivateObjectDir(): string {
    return "";
  }

  async searchPublicObject(_filePath: string): Promise<IStorageFile | null> {
    return null;
  }

  async downloadObject(file: IStorageFile, cacheTtlSec: number = 3600): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclMeta = metadata.metadata?.["aclpolicy"];
    const isPublic = aclMeta
      ? (JSON.parse(aclMeta) as { visibility?: string }).visibility === "public"
      : false;

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": metadata.contentType || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size !== undefined) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const key = `uploads/${randomUUID()}`;
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn: 900 });
  }

  normalizeObjectEntityPath(rawPath: string): string {
    const endpoint = process.env.HETZNER_S3_ENDPOINT;
    if (!endpoint) return rawPath;

    let isHetznerUrl = false;
    try {
      const endpointHost = new URL(endpoint).host;
      const rawHost = new URL(rawPath).host;
      isHetznerUrl =
        rawPath.startsWith(endpoint) ||
        rawHost === endpointHost ||
        rawHost.endsWith(`.${endpointHost}`);
    } catch {
      return rawPath;
    }

    if (!isHetznerUrl) return rawPath;

    try {
      const url = new URL(rawPath);
      // path-style: /<bucket>/<key>
      let pathname = url.pathname;
      // Strip leading slash and bucket prefix
      pathname = pathname.replace(/^\//, "");
      const bucket = this.bucket;
      if (pathname.startsWith(`${bucket}/`)) {
        pathname = pathname.slice(bucket.length + 1);
      }
      // Strip trailing query (already gone because we used url.pathname)
      // Result: "uploads/<uuid>" → "/objects/uploads/<uuid>"
      return `/objects/${pathname}`;
    } catch {
      return rawPath;
    }
  }

  async getObjectEntityFile(objectPath: string): Promise<IStorageFile> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const key = objectPath.slice("/objects/".length);
    if (!key) {
      throw new ObjectNotFoundError();
    }
    const file = new HetznerStorageFile(this.s3, this.bucket, key);
    const [exists] = await file.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return file;
  }

  async uploadBytesAsEntity(subpath: string, buf: Buffer, contentType: string): Promise<string> {
    const file = new HetznerStorageFile(this.s3, this.bucket, subpath);
    await file.save(buf, { contentType });
    return `/objects/${subpath}`;
  }
}
