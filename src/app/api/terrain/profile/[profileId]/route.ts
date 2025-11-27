import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { apiResponse } from '@/lib/utils/response';

/**
 * GET /api/terrain/profile/[profileId]
 * Retrieve elevation profile data and statistics
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

    return apiResponse({
      success: true,
      data: {
        profileId: profile.id,
        projectId: profile.projectId,
        name: profile.name,
        description: profile.description,
        parameters: {
          sampleInterval: profile.sampleInterval,
          sampleCount: profile.sampleCount,
          maxGradeThreshold: profile.maxGradeThreshold
        },
        statistics: {
          totalDistance: profile.totalDistance,
          elevationGain: profile.elevationGain,
          elevationLoss: profile.elevationLoss,
          netElevationChange: profile.netElevationChange,
          startElevation: profile.startElevation,
          endElevation: profile.endElevation,
          minElevation: profile.minElevation,
          maxElevation: profile.maxElevation,
          maxGradeUphill: profile.maxGradeUphill,
          maxGradeDownhill: profile.maxGradeDownhill,
          excessiveGradeDistance: profile.excessiveGradeDistance,
          excessiveGradePercent: profile.excessiveGradePercent
        },
        exports: {
          csv: `/api/terrain/profile/${profileId}/csv`,
          png: `/api/terrain/profile/${profileId}/png`,
          chart: `/api/terrain/profile/${profileId}/chart`
        },
        createdAt: profile.createdAt.toISOString(),
        processingTimeMs: profile.processingTimeMs
      }
    });

  } catch (error) {
    console.error('Failed to retrieve elevation profile:', error);

    return apiResponse(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/terrain/profile/[profileId]
 * Delete elevation profile
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { profileId: string } }
) {
  try {
    const { profileId } = params;

    await prisma.elevationProfile.delete({
      where: { id: profileId }
    });

    return apiResponse({
      success: true,
      message: 'Profile deleted successfully'
    });

  } catch (error) {
    console.error('Failed to delete elevation profile:', error);

    return apiResponse(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
