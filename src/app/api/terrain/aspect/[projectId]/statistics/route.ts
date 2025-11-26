import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { apiResponse } from '@/lib/utils/response';

/**
 * GET /api/terrain/aspect/[projectId]/statistics
 * Get aspect distribution statistics
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

    // Return statistics only
    return apiResponse({
      success: true,
      data: {
        projectId,
        parameters: {
          flatAreaThreshold: aspectAnalysis.flatAreaThreshold
        },
        statistics: {
          flatPercent: aspectAnalysis.flatPercent,
          directionalDistribution: {
            N: aspectAnalysis.northPercent,
            NE: aspectAnalysis.northeastPercent,
            E: aspectAnalysis.eastPercent,
            SE: aspectAnalysis.southeastPercent,
            S: aspectAnalysis.southPercent,
            SW: aspectAnalysis.southwestPercent,
            W: aspectAnalysis.westPercent,
            NW: aspectAnalysis.northwestPercent
          },
          dominantDirection: aspectAnalysis.dominantDirection,
          circularMeanAspect: aspectAnalysis.circularMeanAspect,
          solarAnalysis: {
            northFacingPercent: aspectAnalysis.northFacingPercent,
            southFacingPercent: aspectAnalysis.southFacingPercent,
            eastWestPercent:
              100 -
              aspectAnalysis.northFacingPercent -
              aspectAnalysis.southFacingPercent -
              aspectAnalysis.flatPercent,
            note: 'South-facing = better solar exposure in northern hemisphere'
          }
        },
        calculatedAt: aspectAnalysis.calculatedAt.toISOString()
      }
    });

  } catch (error) {
    console.error('Failed to retrieve aspect statistics:', error);

    return apiResponse(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
