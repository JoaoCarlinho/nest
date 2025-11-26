/**
 * Story 1.5: Buildable Area API
 * GET /api/buildable-area/:projectId
 *
 * Returns calculated buildable area for a project.
 * Buildable area = Property boundary - Exclusion zones (with buffers)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calculateAndSaveBuildableArea } from '@/lib/geospatial/buildable-area-calculator';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: 'projectId is required' },
        { status: 400 }
      );
    }

    // Check if property boundary exists
    const propertyBoundary = await prisma.propertyBoundary.findFirst({
      where: { projectId },
    });

    if (!propertyBoundary) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Property boundary not found. Please upload property boundary KML first (Story 1.2).',
        },
        { status: 404 }
      );
    }

    // Check for existing buildable area calculation
    let buildableArea = await prisma.buildableArea.findUnique({
      where: { projectId },
    });

    // If buildable area doesn't exist or is stale, recalculate
    if (!buildableArea) {
      try {
        const result = await calculateAndSaveBuildableArea(projectId);

        // Fetch the created record
        buildableArea = await prisma.buildableArea.findUnique({
          where: { projectId },
        });
      } catch (error) {
        return NextResponse.json(
          {
            success: false,
            error: `Failed to calculate buildable area: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          },
          { status: 500 }
        );
      }
    }

    if (!buildableArea) {
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to retrieve buildable area after calculation',
        },
        { status: 500 }
      );
    }

    // Get exclusion zones for context
    const exclusionZones = await prisma.exclusionZone.findMany({
      where: { projectId },
      select: {
        id: true,
        name: true,
        type: true,
        areaAcres: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        buildableAreaId: buildableArea.id,
        projectId: buildableArea.projectId,
        geometry: buildableArea.geometry,
        area: {
          squareMeters: buildableArea.areaSquareMeters,
          acres: buildableArea.areaAcres,
          hectares: buildableArea.areaHectares,
        },
        statistics: {
          totalPropertyArea: {
            squareMeters: buildableArea.totalPropertyArea,
            acres: (buildableArea.totalPropertyArea / 4046.86).toFixed(2),
          },
          excludedArea: {
            squareMeters: buildableArea.excludedArea,
            acres: (buildableArea.excludedArea / 4046.86).toFixed(2),
          },
          buildableArea: {
            squareMeters: buildableArea.areaSquareMeters,
            acres: buildableArea.areaAcres.toFixed(2),
            hectares: buildableArea.areaHectares.toFixed(2),
          },
          buildablePercent: buildableArea.buildablePercent.toFixed(1),
          exclusionCount: buildableArea.exclusionCount,
        },
        exclusionZones,
        calculatedAt: buildableArea.calculatedAt,
      },
    });
  } catch (error) {
    console.error('Error fetching buildable area:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to fetch buildable area',
      },
      { status: 500 }
    );
  }
}
