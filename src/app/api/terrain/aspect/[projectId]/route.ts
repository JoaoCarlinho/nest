import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { apiResponse } from '@/lib/utils/response';

/**
 * GET /api/terrain/aspect/[projectId]
 * Retrieve aspect (orientation) analysis results
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

    // Return complete aspect analysis results
    return apiResponse({
      success: true,
      data: {
        analysisId: aspectAnalysis.id,
        projectId: aspectAnalysis.projectId,
        status: 'completed',
        parameters: {
          flatAreaThreshold: aspectAnalysis.flatAreaThreshold
        },
        statistics: {
          flatPercent: aspectAnalysis.flatPercent,
          distribution: {
            north: {
              direction: 'N',
              degrees: '337.5° - 22.5°',
              percent: aspectAnalysis.northPercent
            },
            northeast: {
              direction: 'NE',
              degrees: '22.5° - 67.5°',
              percent: aspectAnalysis.northeastPercent
            },
            east: {
              direction: 'E',
              degrees: '67.5° - 112.5°',
              percent: aspectAnalysis.eastPercent
            },
            southeast: {
              direction: 'SE',
              degrees: '112.5° - 157.5°',
              percent: aspectAnalysis.southeastPercent
            },
            south: {
              direction: 'S',
              degrees: '157.5° - 202.5°',
              percent: aspectAnalysis.southPercent
            },
            southwest: {
              direction: 'SW',
              degrees: '202.5° - 247.5°',
              percent: aspectAnalysis.southwestPercent
            },
            west: {
              direction: 'W',
              degrees: '247.5° - 292.5°',
              percent: aspectAnalysis.westPercent
            },
            northwest: {
              direction: 'NW',
              degrees: '292.5° - 337.5°',
              percent: aspectAnalysis.northwestPercent
            }
          },
          dominantDirection: aspectAnalysis.dominantDirection,
          circularMeanAspect: aspectAnalysis.circularMeanAspect,
          solarAnalysis: {
            northFacingPercent: aspectAnalysis.northFacingPercent,
            southFacingPercent: aspectAnalysis.southFacingPercent,
            note: 'South-facing slopes receive more solar exposure in northern hemisphere'
          }
        },
        outputs: {
          aspectGeoTiff: `/api/terrain/aspect/${projectId}/geotiff?type=aspect`,
          classifiedGeoTiff: `/api/terrain/aspect/${projectId}/geotiff?type=classified`,
          visualizationPng: `/api/terrain/aspect/${projectId}/visualization`,
          northFacingAreasGeojson: aspectAnalysis.northFacingAreasGeojson,
          southFacingAreasGeojson: aspectAnalysis.southFacingAreasGeojson
        },
        calculatedAt: aspectAnalysis.calculatedAt.toISOString(),
        processingTimeMs: aspectAnalysis.processingTimeMs
      }
    });

  } catch (error) {
    console.error('Failed to retrieve aspect analysis:', error);

    return apiResponse(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
