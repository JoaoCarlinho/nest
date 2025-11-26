/**
 * S3 Signed URL Generation
 *
 * Generates presigned URLs for secure file downloads from S3.
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface SignedUrlConfig {
  bucketName: string;
  region: string;
  expiresIn?: number; // seconds, default 3600 (1 hour)
}

/**
 * S3 Signed URL Generator
 */
export class S3SignedUrlGenerator {
  private s3Client: S3Client;
  private bucketName: string;
  private defaultExpiresIn: number;

  constructor(config: SignedUrlConfig) {
    this.bucketName = config.bucketName;
    this.defaultExpiresIn = config.expiresIn ?? 3600; // 1 hour default
    this.s3Client = new S3Client({ region: config.region });
  }

  /**
   * Generate a presigned URL for downloading a file from S3
   * @param s3Key - S3 object key (file path)
   * @param expiresIn - Expiration time in seconds (optional)
   * @returns Presigned URL and expiration date
   */
  async generateDownloadUrl(
    s3Key: string,
    expiresIn?: number
  ): Promise<{
    url: string;
    expiresAt: Date;
  }> {
    const expiration = expiresIn ?? this.defaultExpiresIn;

    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
    });

    const url = await getSignedUrl(this.s3Client, command, {
      expiresIn: expiration,
    });

    const expiresAt = new Date(Date.now() + expiration * 1000);

    return {
      url,
      expiresAt,
    };
  }

  /**
   * Generate download URL with custom response headers
   * @param s3Key - S3 object key
   * @param filename - Downloaded filename
   * @param expiresIn - Expiration time in seconds
   * @returns Presigned URL and expiration date
   */
  async generateDownloadUrlWithFilename(
    s3Key: string,
    filename: string,
    expiresIn?: number
  ): Promise<{
    url: string;
    expiresAt: Date;
  }> {
    const expiration = expiresIn ?? this.defaultExpiresIn;

    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    });

    const url = await getSignedUrl(this.s3Client, command, {
      expiresIn: expiration,
    });

    const expiresAt = new Date(Date.now() + expiration * 1000);

    return {
      url,
      expiresAt,
    };
  }
}

/**
 * Create S3 signed URL generator from environment variables
 */
export function createS3SignedUrlGenerator(): S3SignedUrlGenerator {
  const bucketName = process.env.AWS_S3_BUCKET_NAME;
  const region = process.env.AWS_REGION || 'us-west-2';

  if (!bucketName) {
    throw new Error('AWS_S3_BUCKET_NAME environment variable is required');
  }

  return new S3SignedUrlGenerator({ bucketName, region });
}
