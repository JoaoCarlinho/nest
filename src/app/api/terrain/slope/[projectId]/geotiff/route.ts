import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { generateSignedUrl } from '@/lib/storage/s3-signed-urls';
import { apiResponse } from '@/lib/utils/response';

/**
 * GET /api/terrain/slope/[projectId]/geotiff
 * Download slope GeoTIFF file
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const { projectId } = params;
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type') || 'slope'; // 'slope' or 'classified'

    // Retrieve slope analysis
    const slopeAnalysis = await prisma.slopeAnalysis.findUnique({
      where: { projectId }
    });

    if (!slopeAnalysis) {
      return apiResponse(
        { error: 'Slope analysis not found' },
        { status: 404 }
      );
    }

    // Select appropriate GeoTIFF based on type
    const s3Path = type === 'classified'
      ? slopeAnalysis.classifiedGeoTiffPath
      : slopeAnalysis.slopeGeoTiffPath;

    if (!s3Path) {
      return apiResponse(
        { error: 'GeoTIFF file not found' },
        { status: 404 }
      );
    }

    // Generate signed URL (valid for 1 hour)
    const signedUrl = await generateSignedUrl(s3Path, 3600);

    // Return redirect to signed URL
    return NextResponse.redirect(signedUrl);

  } catch (error) {
    console.error('Failed to generate GeoTIFF download URL:', error);

    return apiResponse(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
