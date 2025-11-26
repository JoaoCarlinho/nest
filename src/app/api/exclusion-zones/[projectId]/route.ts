/**
 * Story 1.5: Exclusion Zone Listing API
 * GET /api/exclusion-zones/:projectId
 *
 * Returns all exclusion zones for a project with visual representation data.
 * Includes color coding by zone type for map visualization.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Color coding for zone types (for map visualization)
const ZONE_TYPE_COLORS = {
  WETLAND: '#3B82F6', // Blue
  PROTECTED_AREA: '#10B981', // Green
  EASEMENT: '#EAB308', // Yellow
  BUFFER: '#F59E0B', // Orange
  SETBACK: '#EF4444', // Red
  CUSTOM: '#6B7280', // Gray
} as const;

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

    // Get property boundary for context
    const propertyBoundary = await prisma.propertyBoundary.findFirst({
      where: { projectId },
    });

    if (!propertyBoundary) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Property boundary not found for project. Please upload property boundary first.',
        },
        { status: 404 }
      );
    }

    // Get all exclusion zones for project
    const exclusionZones = await prisma.exclusionZone.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });

    // Get buildable area (if calculated)
    const buildableArea = await prisma.buildableArea.findUnique({
      where: { projectId },
    });

    // Format exclusion zones with color coding
    const formattedZones = exclusionZones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      type: zone.type,
      description: zone.description,
      geometry: zone.geometry,
      bufferedGeometry: zone.bufferedGeometry,
      bufferDistance: zone.bufferDistance,
      areaSquareMeters: zone.areaSquareMeters,
      areaAcres: zone.areaAcres,
      attributes: zone.attributes,
      color: ZONE_TYPE_COLORS[zone.type],
      createdAt: zone.createdAt,
      updatedAt: zone.updatedAt,
    }));

    // Calculate statistics
    const totalExcludedArea = exclusionZones.reduce(
      (sum, zone) => sum + zone.areaSquareMeters,
      0
    );
    const totalExcludedAcres = totalExcludedArea / 4046.86;

    return NextResponse.json({
      success: true,
      data: {
        projectId,
        propertyBoundary: {
          geometry: propertyBoundary.geometry,
          areaSquareMeters: propertyBoundary.areaSquareMeters,
          areaAcres: propertyBoundary.areaAcres,
        },
        exclusionZones: formattedZones,
        buildableArea: buildableArea
          ? {
              geometry: buildableArea.geometry,
              areaSquareMeters: buildableArea.areaSquareMeters,
              areaAcres: buildableArea.areaAcres,
              areaHectares: buildableArea.areaHectares,
              buildablePercent: buildableArea.buildablePercent,
              calculatedAt: buildableArea.calculatedAt,
            }
          : null,
        statistics: {
          totalZones: exclusionZones.length,
          totalExcludedArea: {
            squareMeters: totalExcludedArea.toFixed(2),
            acres: totalExcludedAcres.toFixed(2),
          },
          zonesByType: exclusionZones.reduce(
            (acc, zone) => {
              acc[zone.type] = (acc[zone.type] || 0) + 1;
              return acc;
            },
            {} as Record<string, number>
          ),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching exclusion zones:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to fetch exclusion zones',
      },
      { status: 500 }
    );
  }
}
