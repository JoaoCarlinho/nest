import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { generateSignedUrl } from '@/lib/storage/s3-signed-urls';
import { apiResponse } from '@/lib/utils/response';

/**
 * GET /api/terrain/aspect/[projectId]/geotiff
 * Download aspect GeoTIFF file
 * Query params: type=aspect (default) or type=classified
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const { projectId } = params;
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type') || 'aspect'; // 'aspect' or 'classified'

    // Retrieve aspect analysis
    const aspectAnalysis = await prisma.aspectAnalysis.findUnique({
      where: { projectId }
    });

    if (!aspectAnalysis) {
      return apiResponse(
        { error: 'Aspect analysis not found' },
        { status: 404 }
      );
    }

    // Select appropriate GeoTIFF based on type
    const s3Path = type === 'classified'
      ? aspectAnalysis.classifiedGeoTiffPath
      : aspectAnalysis.aspectGeoTiffPath;

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
