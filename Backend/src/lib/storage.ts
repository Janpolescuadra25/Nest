import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET!;

export interface UploadedFile {
  storageKey: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export async function uploadFile(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  userId: string,
): Promise<UploadedFile> {
  const timestamp = Date.now();
  const sanitized = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storageKey = `scans/${userId}/${timestamp}-${sanitized}`;

  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
    Body: buffer,
    ContentType: mimeType,
  }));

  return { storageKey, fileName: originalName, fileSize: buffer.length, mimeType };
}

export async function uploadAgreementDoc(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  adminId: string,
): Promise<UploadedFile> {
  const sanitized = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const timestamp = Date.now();
  const storageKey = `agreements/${adminId}/${timestamp}-${sanitized}`;

  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
    Body: buffer,
    ContentType: mimeType,
  }));

  return { storageKey, fileName: originalName, fileSize: buffer.length, mimeType };
}

export async function uploadLocationAttachment(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  locationId: string,
): Promise<UploadedFile> {
  const sanitized = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const timestamp = Date.now();
  const storageKey = `locations/${locationId}/${timestamp}-${sanitized}`;

  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
    Body: buffer,
    ContentType: mimeType,
  }));

  return { storageKey, fileName: originalName, fileSize: buffer.length, mimeType };
}

export async function getPresignedUrl(storageKey: string, expirySeconds = 3600): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: storageKey });
  return getSignedUrl(s3Client, command, { expiresIn: expirySeconds });
}

export async function deleteFile(storageKey: string): Promise<void> {
  await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: storageKey }));
}

export async function verifyStorageBucketAccessible(): Promise<void> {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch (err: unknown) {
    throw new Error(`Storage bucket access failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Download a file from R2 and return it as a Buffer.
 * Used server-side to re-upload files to QuickBooks.
 */
export async function getFileBuffer(storageKey: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const response = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: storageKey }));
  const bytes = await response.Body!.transformToByteArray();
  const buffer = Buffer.from(bytes);
  return { buffer, mimeType: response.ContentType || 'application/octet-stream' };
}
