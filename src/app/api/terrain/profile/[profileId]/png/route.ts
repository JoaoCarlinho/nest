import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { generateSignedUrl } from '@/lib/storage/s3-signed-urls';
import { apiResponse } from '@/lib/utils/response';

/**
 * GET /api/terrain/profile/[profileId]/png
 * Download elevation profile chart PNG
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { profileId: string } }
) {
  try {
    const { profileId } = params;

    const profile = await prisma.elevationProfile.findUnique({
      where: { id: profileId }
    });

    if (!profile) {
      return apiResponse(
        { error: 'Elevation profile not found' },
        { status: 404 }
      );
    }

    const s3Path = profile.profileChartPng;

    if (!s3Path) {
      return apiResponse(
        { error: 'PNG chart file not found' },
        { status: 404 }
      );
    }

    // Generate signed URL (valid for 1 hour)
    const signedUrl = await generateSignedUrl(s3Path, 3600);

    // Return redirect to signed URL
    return NextResponse.redirect(signedUrl);

  } catch (error) {
    console.error('Failed to generate PNG download URL:', error);

    return apiResponse(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
