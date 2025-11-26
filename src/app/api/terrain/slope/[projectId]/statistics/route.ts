import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { apiResponse } from '@/lib/utils/response';

/**
 * GET /api/terrain/slope/[projectId]/statistics
 * Get slope distribution statistics
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

    // Return statistics only
    return apiResponse({
      success: true,
      data: {
        projectId,
        statistics: {
          meanSlope: slopeAnalysis.meanSlope,
          medianSlope: slopeAnalysis.medianSlope,
          maxSlope: slopeAnalysis.maxSlope,
          distribution: {
            flat: {
              threshold: `0-${slopeAnalysis.flatThreshold}%`,
              percent: slopeAnalysis.flatPercent
            },
            moderate: {
              threshold: `${slopeAnalysis.flatThreshold}-${slopeAnalysis.moderateThreshold}%`,
              percent: slopeAnalysis.moderatePercent
            },
            steep: {
              threshold: `${slopeAnalysis.moderateThreshold}-${slopeAnalysis.steepThreshold}%`,
              percent: slopeAnalysis.steepPercent
            },
            verySteep: {
              threshold: `>${slopeAnalysis.steepThreshold}%`,
              percent: slopeAnalysis.verySteepPercent
            }
          },
          buildability: {
            maxBuildableSlope: slopeAnalysis.maxBuildableSlope,
            unbuildablePercent: slopeAnalysis.unbuildablePercent,
            buildablePercent: 100 - slopeAnalysis.unbuildablePercent
          }
        },
        calculatedAt: slopeAnalysis.calculatedAt.toISOString()
      }
    });

  } catch (error) {
    console.error('Failed to retrieve slope statistics:', error);

    return apiResponse(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
