/**
 * Story 1.5: Manual Exclusion Zone Creation API
 * POST /api/exclusion-zones/create
 *
 * Creates an exclusion zone from manually drawn GeoJSON polygon (e.g., from Mapbox Draw).
 * Validates geometry, applies buffers, and recalculates buildable area.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  validateZoneWithinBoundary,
  isValidPolygonGeometry,
} from '@/lib/geospatial/zone-validator';
import {
  applyZoneBuffer,
  getDefaultBufferDistance,
  validateBufferDistance,
} from '@/lib/geospatial/zone-buffer';
import { calculateAndSaveBuildableArea } from '@/lib/geospatial/buildable-area-calculator';
import { ExclusionZoneType } from '@prisma/client';
import * as turf from '@turf/turf';
import type { Polygon } from 'geojson';

interface CreateZoneRequest {
  projectId: string;
  userId: string; // TODO: Extract from auth session
  name: string;
  type: ExclusionZoneType;
  description?: string;
  geometry: Polygon;
  bufferDistance?: number; // Optional: override default buffer
  attributes?: Record<string, any>;
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateZoneRequest = await request.json();

    // Validate required fields
    if (!body.projectId) {
      return NextResponse.json(
        { success: false, error: 'projectId is required' },
        { status: 400 }
      );
    }

    if (!body.userId) {
      return NextResponse.json(
        { success: false, error: 'userId is required (authentication)' },
        { status: 401 }
      );
    }

    if (!body.name) {
      return NextResponse.json(
        { success: false, error: 'name is required' },
        { status: 400 }
      );
    }

    if (!body.type) {
      return NextResponse.json(
        { success: false, error: 'type is required' },
        { status: 400 }
      );
    }

    if (!body.geometry) {
      return NextResponse.json(
        { success: false, error: 'geometry is required' },
        { status: 400 }
      );
    }

    // Validate zone type
    const validZoneTypes = Object.values(ExclusionZoneType);
    if (!validZoneTypes.includes(body.type)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid zone type. Must be one of: ${validZoneTypes.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Validate geometry is a valid polygon
    if (!isValidPolygonGeometry(body.geometry)) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Invalid polygon geometry (self-intersecting or unclosed). Please redraw the zone.',
        },
        { status: 400 }
      );
    }

    // Get property boundary for validation
    const propertyBoundary = await prisma.propertyBoundary.findFirst({
      where: { projectId: body.projectId },
    });

    if (!propertyBoundary) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Property boundary required before adding exclusion zones. Please upload property boundary KML first (Story 1.2).',
        },
        { status: 400 }
      );
    }

    // Validate zone is within property boundary
    const validation = validateZoneWithinBoundary(
      body.geometry,
      propertyBoundary.geometry as unknown as Polygon,
      { tolerance: 1.0 }
    );

    if (!validation.valid) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error,
          details: {
            outsidePercent: validation.outsidePercent,
            outsideAreaSquareMeters: validation.outsideAreaSquareMeters,
          },
        },
        { status: 400 }
      );
    }

    // Calculate zone area
    const zonePoly = turf.polygon(body.geometry.coordinates);
    const areaSquareMeters = turf.area(zonePoly);
    const areaAcres = areaSquareMeters / 4046.86;

    // Determine buffer distance (use provided or default for zone type)
    let bufferDistance = body.bufferDistance;
    if (bufferDistance === undefined || bufferDistance === null) {
      bufferDistance = getDefaultBufferDistance(body.type);
    }

    // Validate buffer distance
    const bufferValidation = validateBufferDistance(bufferDistance);
    if (!bufferValidation.valid) {
      return NextResponse.json(
        { success: false, error: bufferValidation.error },
        { status: 400 }
      );
    }

    // Apply buffer if needed
    let bufferedGeometry: Polygon | null = null;
    if (bufferDistance > 0) {
      bufferedGeometry = applyZoneBuffer(body.geometry, body.type, {
        distance: bufferDistance,
        simplify: true,
        tolerance: 1.0,
      });
    }

    // Create exclusion zone in database
    const zone = await prisma.exclusionZone.create({
      data: {
        projectId: body.projectId,
        propertyBoundaryId: propertyBoundary.id,
        createdBy: body.userId,
        name: body.name,
        type: body.type,
        description: body.description,
        geometry: body.geometry as any,
        bufferDistance,
        bufferedGeometry: bufferedGeometry as any,
        attributes: body.attributes || {},
        areaSquareMeters,
        areaAcres,
      },
    });

    // Recalculate buildable area
    let buildableArea;
    try {
      buildableArea = await calculateAndSaveBuildableArea(body.projectId);
    } catch (error) {
      console.error('Failed to calculate buildable area:', error);
      // Don't fail the entire request if buildable area calculation fails
    }

    // Return created zone with buildable area update
    return NextResponse.json({
      success: true,
      data: {
        zone: {
          id: zone.id,
          projectId: zone.projectId,
          name: zone.name,
          type: zone.type,
          description: zone.description,
          geometry: zone.geometry,
          bufferedGeometry: zone.bufferedGeometry,
          bufferDistance: zone.bufferDistance,
          areaSquareMeters: zone.areaSquareMeters,
          areaAcres: zone.areaAcres,
          attributes: zone.attributes,
          createdAt: zone.createdAt,
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
    console.error('Exclusion zone creation error:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to create exclusion zone',
      },
      { status: 500 }
    );
  }
}
