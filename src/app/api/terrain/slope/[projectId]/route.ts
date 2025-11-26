import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { apiResponse } from '@/lib/utils/response';

/**
 * GET /api/terrain/slope/[projectId]
 * Retrieve slope analysis results for a project
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const { projectId } = params;

    // Retrieve slope analysis
    const slopeAnalysis = await prisma.slopeAnalysis.findUnique({
      where: { projectId },
      include: {
        project: {
          select: {
            id: true,
            name: true
          }
        },
        dem: {
          select: {
            id: true,
            resolution: true,
            interpolationMethod: true
          }
        }
      }
    });

    if (!slopeAnalysis) {
      return apiResponse(
        {
          error: 'Slope analysis not found',
          suggestion: 'Run slope calculation first via POST /api/terrain/slope/calculate'
        },
        { status: 404 }
      );
    }

    // Format response
    return apiResponse({
      success: true,
      data: {
        analysisId: slopeAnalysis.id,
        projectId: slopeAnalysis.projectId,
        projectName: slopeAnalysis.project.name,
        demId: slopeAnalysis.demId,
        demResolution: slopeAnalysis.dem.resolution,
        parameters: {
          smoothingEnabled: slopeAnalysis.smoothingEnabled,
          smoothingKernelSize: slopeAnalysis.smoothingKernelSize,
          maxBuildableSlope: slopeAnalysis.maxBuildableSlope,
          thresholds: {
            flat: slopeAnalysis.flatThreshold,
            moderate: slopeAnalysis.moderateThreshold,
            steep: slopeAnalysis.steepThreshold
          }
        },
        statistics: {
          meanSlope: slopeAnalysis.meanSlope,
          medianSlope: slopeAnalysis.medianSlope,
          maxSlope: slopeAnalysis.maxSlope,
          distribution: {
            flatPercent: slopeAnalysis.flatPercent,
            moderatePercent: slopeAnalysis.moderatePercent,
            steepPercent: slopeAnalysis.steepPercent,
            verySteepPercent: slopeAnalysis.verySteepPercent
          },
          unbuildablePercent: slopeAnalysis.unbuildablePercent
        },
        outputs: {
          slopeGeoTiff: slopeAnalysis.slopeGeoTiffPath,
          classifiedGeoTiff: slopeAnalysis.classifiedGeoTiffPath,
          heatmapPng: slopeAnalysis.heatmapPngPath,
          unbuildableAreasGeoJson: slopeAnalysis.unbuildableAreasGeoJson
        },
        metadata: {
          calculatedAt: slopeAnalysis.calculatedAt.toISOString(),
          processingTimeMs: slopeAnalysis.processingTimeMs
        }
      }
    });

  } catch (error) {
    console.error('Failed to retrieve slope analysis:', error);

    return apiResponse(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
