import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { generateSignedUrl } from '@/lib/storage/s3-signed-urls';
import { apiResponse } from '@/lib/utils/response';

/**
 * GET /api/terrain/aspect/[projectId]/visualization
 * Download aspect visualization PNG
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const { projectId } = params;

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

    const s3Path = aspectAnalysis.visualizationPngPath;

    if (!s3Path) {
      return apiResponse(
        { error: 'Visualization file not found' },
        { status: 404 }
      );
    }

    // Generate signed URL (valid for 1 hour)
    const signedUrl = await generateSignedUrl(s3Path, 3600);

    // Return redirect to signed URL
    return NextResponse.redirect(signedUrl);

  } catch (error) {
    console.error('Failed to generate visualization download URL:', error);

    return apiResponse(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
