/**
 * Story 1.5: Exclusion Zone Update/Delete API
 * PUT /api/exclusion-zones/:zoneId - Update zone metadata or buffer
 * DELETE /api/exclusion-zones/:zoneId - Delete zone and recalculate buildable area
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { applyZoneBuffer } from '@/lib/geospatial/zone-buffer';
import { calculateAndSaveBuildableArea } from '@/lib/geospatial/buildable-area-calculator';
import type { Polygon } from 'geojson';

interface UpdateZoneRequest {
  name?: string;
  description?: string;
  bufferDistance?: number;
  attributes?: Record<string, any>;
}

/**
 * PUT /api/exclusion-zones/:zoneId
 * Updates exclusion zone metadata or buffer distance.
 * Recalculates buildable area if buffer distance changes.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ zoneId: string }> }
) {
  try {
    const { zoneId } = await params;
    const body: UpdateZoneRequest = await request.json();

    if (!zoneId) {
      return NextResponse.json(
        { success: false, error: 'zoneId is required' },
        { status: 400 }
      );
    }

    // Get existing zone
    const existingZone = await prisma.exclusionZone.findUnique({
      where: { id: zoneId },
    });

    if (!existingZone) {
      return NextResponse.json(
        { success: false, error: 'Exclusion zone not found' },
        { status: 404 }
      );
    }

    // Determine if buffer needs to be recalculated
    const bufferChanged =
      body.bufferDistance !== undefined &&
      body.bufferDistance !== existingZone.bufferDistance;

    let bufferedGeometry = existingZone.bufferedGeometry;

    if (bufferChanged) {
      // Recalculate buffered geometry
      const newBufferDistance = body.bufferDistance!;

      if (newBufferDistance > 0) {
        bufferedGeometry = applyZoneBuffer(
          existingZone.geometry as unknown as Polygon,
          existingZone.type,
          {
            distance: newBufferDistance,
            simplify: true,
            tolerance: 1.0,
          }
        ) as any;
      } else {
        bufferedGeometry = null; // No buffer
      }
    }

    // Update zone in database
    const updatedZone = await prisma.exclusionZone.update({
      where: { id: zoneId },
      data: {
        name: body.name ?? existingZone.name,
        description: body.description ?? existingZone.description,
        bufferDistance: body.bufferDistance ?? existingZone.bufferDistance,
        bufferedGeometry: bufferedGeometry,
        attributes: body.attributes ?? existingZone.attributes,
        updatedAt: new Date(),
      },
    });

    // Recalculate buildable area if buffer changed
    let buildableArea;
    if (bufferChanged) {
      try {
        buildableArea = await calculateAndSaveBuildableArea(
          existingZone.projectId
        );
      } catch (error) {
        console.error('Failed to recalculate buildable area:', error);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        zone: {
          id: updatedZone.id,
          projectId: updatedZone.projectId,
          name: updatedZone.name,
          type: updatedZone.type,
          description: updatedZone.description,
          geometry: updatedZone.geometry,
          bufferedGeometry: updatedZone.bufferedGeometry,
          bufferDistance: updatedZone.bufferDistance,
          areaSquareMeters: updatedZone.areaSquareMeters,
          areaAcres: updatedZone.areaAcres,
          attributes: updatedZone.attributes,
          updatedAt: updatedZone.updatedAt,
        },
        buildableArea: buildableArea
          ? {
              areaAcres: buildableArea.areaAcres.toFixed(2),
              buildablePercent: buildableArea.buildablePercent.toFixed(1),
              exclusionCount: buildableArea.exclusionCount,
            }
          : undefined,
      },
    });
  } catch (error) {
    console.error('Error updating exclusion zone:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to update exclusion zone',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/exclusion-zones/:zoneId
 * Deletes exclusion zone and recalculates buildable area.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ zoneId: string }> }
) {
  try {
    const { zoneId } = await params;

    if (!zoneId) {
      return NextResponse.json(
        { success: false, error: 'zoneId is required' },
        { status: 400 }
      );
    }

    // Get existing zone for project ID
    const existingZone = await prisma.exclusionZone.findUnique({
      where: { id: zoneId },
    });

    if (!existingZone) {
      return NextResponse.json(
        { success: false, error: 'Exclusion zone not found' },
        { status: 404 }
      );
    }

    const projectId = existingZone.projectId;

    // Delete zone
    await prisma.exclusionZone.delete({
      where: { id: zoneId },
    });

    // Recalculate buildable area
    let buildableArea;
    try {
      buildableArea = await calculateAndSaveBuildableArea(projectId);
    } catch (error) {
      console.error('Failed to recalculate buildable area:', error);
      // Don't fail the entire request if buildable area calculation fails
    }

    return NextResponse.json({
      success: true,
      data: {
        deletedZoneId: zoneId,
        projectId,
        buildableArea: buildableArea
          ? {
              areaAcres: buildableArea.areaAcres.toFixed(2),
              buildablePercent: buildableArea.buildablePercent.toFixed(1),
              exclusionCount: buildableArea.exclusionCount,
            }
          : undefined,
      },
    });
  } catch (error) {
    console.error('Error deleting exclusion zone:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to delete exclusion zone',
      },
      { status: 500 }
    );
  }
}
