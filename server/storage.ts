/**
 * Storage Service — Supabase S3-compatible backend
 *
 * Uses the AWS SDK v3 pointed at the Supabase S3 endpoint.
 * Credentials are read from environment variables (never hardcoded).
 *
 * Bucket: hostimage
 * Endpoint: https://pivpvwqynlbdcjryuzwy.storage.supabase.co/storage/v1/s3
 * Region:   eu-west-1
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV } from "./_core/env";

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (_client) return _client;

  const {
    storageEndpoint,
    storageRegion,
    storageAccessKeyId,
    storageSecretAccessKey,
  } = ENV;

  if (!storageEndpoint || !storageAccessKeyId || !storageSecretAccessKey) {
    throw new Error(
      "Storage credentials missing. Set STORAGE_ENDPOINT, STORAGE_ACCESS_KEY_ID, and STORAGE_SECRET_ACCESS_KEY in your environment."
    );
  }

  _client = new S3Client({
    region: storageRegion,
    endpoint: storageEndpoint,
    credentials: {
      accessKeyId: storageAccessKeyId,
      secretAccessKey: storageSecretAccessKey,
    },
    // Required for path-style URLs (Supabase S3 uses path-style)
    forcePathStyle: true,
  });

  return _client;
}

function getBucket(): string {
  return ENV.storageBucket || "hostimage";
}

function normalizeKey(key: string): string {
  return key.replace(/^\/+/, "");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Upload a file to storage.
 * Returns the key and a public URL to the uploaded object.
 */
export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const client = getClient();
  const bucket = getBucket();
  const key = normalizeKey(relKey);

  const body =
    typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data as Uint8Array);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      // Make the object publicly readable
      ACL: "public-read",
    })
  );

  // Build the public URL from the endpoint
  const endpoint = ENV.storageEndpoint.replace(/\/+$/, "");
  const url = `${endpoint}/${bucket}/${key}`;

  return { key, url };
}

/**
 * Get a pre-signed download URL for a stored object (valid 1 hour).
 */
export async function storageGet(
  relKey: string,
  expiresInSeconds = 3600
): Promise<{ key: string; url: string }> {
  const client = getClient();
  const bucket = getBucket();
  const key = normalizeKey(relKey);

  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const url = await getSignedUrl(client, command, { expiresIn: expiresInSeconds });

  return { key, url };
}

/**
 * Delete an object from storage.
 */
export async function storageDelete(relKey: string): Promise<void> {
  const client = getClient();
  const key = normalizeKey(relKey);

  await client.send(
    new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: key,
    })
  );
}

/**
 * Check whether an object exists in storage.
 */
export async function storageExists(relKey: string): Promise<boolean> {
  const client = getClient();
  const key = normalizeKey(relKey);

  try {
    await client.send(
      new HeadObjectCommand({ Bucket: getBucket(), Key: key })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * List objects under a key prefix (folder).
 */
export async function storageList(
  prefix: string,
  maxKeys = 100
): Promise<Array<{ key: string; size?: number; lastModified?: Date }>> {
  const client = getClient();

  const resp = await client.send(
    new ListObjectsV2Command({
      Bucket: getBucket(),
      Prefix: normalizeKey(prefix),
      MaxKeys: maxKeys,
    })
  );

  return (resp.Contents ?? []).map((obj) => ({
    key: obj.Key ?? "",
    size: obj.Size,
    lastModified: obj.LastModified,
  }));
}

/**
 * Upload a product image by fetching it from a remote URL and storing it.
 * Returns the new storage URL.
 */
export async function storeProductImage(
  imageUrl: string,
  productSku: string,
  index: number
): Promise<string> {
  const response = await fetch(imageUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; JumiaQualityBot/1.0)" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch image ${imageUrl}: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "image/jpeg";
  const ext = contentType.split("/")[1]?.split(";")[0] ?? "jpg";
  const buffer = Buffer.from(await response.arrayBuffer());

  const key = `products/${productSku}/image-${index}.${ext}`;
  const { url } = await storagePut(key, buffer, contentType);
  return url;
}
