import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { generateSignedUrl } from '@/lib/storage/s3-signed-urls';
import { apiResponse } from '@/lib/utils/response';

/**
 * GET /api/terrain/slope/[projectId]/heatmap
 * Download slope heatmap PNG visualization
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const { projectId } = params;

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

    const s3Path = slopeAnalysis.heatmapPngPath;

    if (!s3Path) {
      return apiResponse(
        { error: 'Heatmap file not found' },
        { status: 404 }
      );
    }

    // Generate signed URL (valid for 1 hour)
    const signedUrl = await generateSignedUrl(s3Path, 3600);

    // Return redirect to signed URL
    return NextResponse.redirect(signedUrl);

  } catch (error) {
    console.error('Failed to generate heatmap download URL:', error);

    return apiResponse(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
