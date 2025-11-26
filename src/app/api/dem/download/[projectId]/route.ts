/**
 * GET /api/dem/download/:projectId
 *
 * Generate presigned download URL for project's DEM GeoTIFF file.
 * Returns S3 signed URL with 1-hour expiration.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createS3SignedUrlGenerator } from '@/lib/storage/s3-signed-urls';

export const runtime = 'nodejs';

interface RouteParams {
  params: {
    projectId: string;
  };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { projectId } = params;

    // Fetch DEM for project
    const dem = await prisma.digitalElevationModel.findUnique({
      where: { projectId },
      include: {
        project: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!dem) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'DEM not found for this project',
            details: { projectId },
          },
        },
        { status: 404 }
      );
    }

    // Generate presigned download URL
    const urlGenerator = createS3SignedUrlGenerator();
    const filename = `${dem.project.name.replace(/[^a-z0-9]/gi, '_')}_dem_${dem.resolution}m.tif`;
    const { url, expiresAt } = await urlGenerator.generateDownloadUrlWithFilename(
      dem.s3Path,
      filename
    );

    return NextResponse.json({
      success: true,
      data: {
        demId: dem.id,
        downloadUrl: url,
        expiresAt: expiresAt.toISOString(),
        metadata: {
          resolution: dem.resolution,
          width: dem.width,
          height: dem.height,
          interpolationMethod: dem.interpolationMethod,
          fileSize: dem.fileSize,
          bounds: {
            minLat: dem.minLat,
            maxLat: dem.maxLat,
            minLng: dem.minLng,
            maxLng: dem.maxLng,
          },
          elevation: {
            min: dem.minElevation,
            max: dem.maxElevation,
            avg: dem.avgElevation,
          },
          validation: {
            rmse: dem.rmse,
            maxDeviation: dem.maxDeviation,
            contourMatchPercentage: dem.contourMatchPercentage,
          },
          generatedAt: dem.generatedAt.toISOString(),
        },
      },
    });
  } catch (error) {
    console.error('DEM download URL generation error:', error);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to generate download URL',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
      },
      { status: 500 }
    );
  }
}
