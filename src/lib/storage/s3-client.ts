import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommandInput,
} from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-west-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME!;

/**
 * Upload file to S3 with server-side encryption
 * @param file - File buffer to upload
 * @param key - S3 object key (path)
 * @param contentType - MIME type
 * @returns S3 object key
 */
export async function uploadFile(
  file: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  const params: PutObjectCommandInput = {
    Bucket: BUCKET_NAME,
    Key: key,
    Body: file,
    ContentType: contentType,
    ServerSideEncryption: 'AES256',
  };

  await s3Client.send(new PutObjectCommand(params));
  return key;
}

/**
 * Get file from S3
 * @param key - S3 object key
 * @returns File buffer
 */
export async function getObject(key: string): Promise<Buffer> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  const response = await s3Client.send(command);
  const chunks: Uint8Array[] = [];

  if (!response.Body) {
    throw new Error(`No body in S3 response for key: ${key}`);
  }

  // Stream to buffer
  for await (const chunk of response.Body as any) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

/**
 * Delete file from S3
 * @param key - S3 object key
 */
export async function deleteObject(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  await s3Client.send(command);
}

/**
 * Generate S3 key for uploaded file
 * Format: {environment}/uploads/{userId}/{uuid}.{ext}
 */
export function generateS3Key(
  userId: string,
  fileId: string,
  extension: string
): string {
  const environment = process.env.NODE_ENV || 'development';
  return `${environment}/uploads/${userId}/${fileId}.${extension}`;
}
