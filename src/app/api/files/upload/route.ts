import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { uploadFile, generateS3Key } from '@/lib/storage/s3-client';
import { extractKMLFromKMZ } from '@/lib/file-processing/kmz-extractor';
import { validateKMLOrThrow } from '@/lib/file-processing/kml-validator';
import {
  sanitizeXMLContent,
  isValidFileType,
  getFileExtension,
} from '@/lib/file-processing/file-sanitizer';
import { FileUploadError } from '@/lib/errors/FileUploadError';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { isRateLimited } from '@/lib/middleware/rate-limiter';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

/**
 * POST /api/files/upload
 * Upload and validate KMZ/KML files
 */
export async function POST(request: NextRequest) {
  try {
    // For MVP, use a test user ID (will be replaced with real auth in future stories)
    const userId = 'test-user-001';

    // Rate limiting check
    if (isRateLimited(userId, 10, 60000)) {
      return errorResponse(
        'Rate limit exceeded. Maximum 10 uploads per minute.',
        'RATE_LIMIT_EXCEEDED',
        429,
        { maxRequests: 10, windowMs: 60000 }
      );
    }

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return errorResponse(
        'No file provided. Please upload a KML or KMZ file.',
        'FILE_REQUIRED',
        400
      );
    }

    // Validate file type
    if (!isValidFileType(file.name)) {
      throw new FileUploadError('Invalid file type. Only .kml and .kmz files are allowed.', {
        fileType: getFileExtension(file.name),
        validationErrors: [
          {
            message: `File "${file.name}" has unsupported extension. Expected .kml or .kmz`,
          },
        ],
      });
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      throw new FileUploadError('File size exceeds maximum allowed size of 50MB.', {
        maxSize: MAX_FILE_SIZE,
        actualSize: file.size,
        validationErrors: [
          {
            message: `File size ${(file.size / 1024 / 1024).toFixed(2)}MB exceeds limit of 50MB`,
          },
        ],
      });
    }

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Extract KML content (if KMZ) or use directly
    const extension = getFileExtension(file.name);
    let kmlContent: string;

    if (extension === 'kmz') {
      kmlContent = await extractKMLFromKMZ(buffer);
    } else {
      kmlContent = buffer.toString('utf-8');
    }

    // Sanitize KML content
    const sanitizedKML = sanitizeXMLContent(kmlContent);

    // Validate KML structure
    validateKMLOrThrow(sanitizedKML);

    // Generate unique file ID and S3 key
    const fileId = randomUUID();
    const s3Key = generateS3Key(userId, fileId, extension);

    // Upload to S3
    await uploadFile(buffer, s3Key, file.type || 'application/vnd.google-earth.kml+xml');

    // Calculate expiration date (7 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Store metadata in database
    const uploadedFile = await prisma.uploadedFile.create({
      data: {
        id: fileId,
        userId,
        originalName: file.name,
        storedName: s3Key,
        size: file.size,
        contentType: file.type || 'application/vnd.google-earth.kml+xml',
        expiresAt,
      },
    });

    // Return success response
    return successResponse(
      {
        fileId: uploadedFile.id,
        originalName: uploadedFile.originalName,
        size: uploadedFile.size,
        contentType: uploadedFile.contentType,
        uploadedAt: uploadedFile.uploadedAt.toISOString(),
        expiresAt: uploadedFile.expiresAt.toISOString(),
      },
      201
    );
  } catch (error) {
    console.error('File upload error:', error);

    // Handle known error types
    if (error instanceof FileUploadError) {
      return errorResponse(
        error.message,
        error.code,
        error.statusCode,
        error.details
      );
    }

    // Handle unexpected errors
    return errorResponse(
      'An unexpected error occurred during file upload.',
      'INTERNAL_SERVER_ERROR',
      500,
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    );
  }
}

/**
 * OPTIONS /api/files/upload
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
