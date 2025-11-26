/**
 * Story 1.5: Exclusion Zone Upload API
 * POST /api/exclusion-zones/upload
 *
 * Uploads KML file containing exclusion zones, parses polygons, validates against boundary,
 * applies buffers, and stores in database. Triggers buildable area recalculation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { prisma } from '@/lib/prisma';
import { KMLExclusionZoneParser } from '@/lib/geospatial/kml-exclusion-zone-parser';
import { validateZoneWithinBoundary } from '@/lib/geospatial/zone-validator';
import {
  applyZoneBuffer,
  getDefaultBufferDistance,
} from '@/lib/geospatial/zone-buffer';
import { calculateAndSaveBuildableArea } from '@/lib/geospatial/buildable-area-calculator';
import * as turf from '@turf/turf';
import type { Polygon } from 'geojson';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-west-2' });

export async function POST(request: NextRequest) {
  try {
    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const projectId = formData.get('projectId') as string | null;
    const userId = formData.get('userId') as string | null; // TODO: Extract from auth session

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file provided' },
        { status: 400 }
      );
    }

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: 'projectId is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'userId is required (authentication)' },
        { status: 401 }
      );
    }

    // Validate file type
    if (!file.name.endsWith('.kml') && !file.name.endsWith('.xml')) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid file type. Only KML files are supported.',
        },
        { status: 400 }
      );
    }

    // Get property boundary for validation
    const propertyBoundary = await prisma.propertyBoundary.findFirst({
      where: { projectId },
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

    // Read file content
    const arrayBuffer = await file.arrayBuffer();
    const kmlContent = Buffer.from(arrayBuffer).toString('utf-8');

    // Parse KML file
    const parser = new KMLExclusionZoneParser();
    const parsedZones = parser.parseAll(kmlContent);

    // Upload file to S3
    const timestamp = Date.now();
    const s3Key = `exclusion-zones/${projectId}/${timestamp}-${file.name}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME!,
        Key: s3Key,
        Body: Buffer.from(arrayBuffer),
        ContentType: 'application/vnd.google-earth.kml+xml',
      })
    );

    // Create uploaded file record
    const uploadedFile = await prisma.uploadedFile.create({
      data: {
        userId,
        originalName: file.name,
        storedName: s3Key,
        size: file.size,
        contentType: file.type || 'application/vnd.google-earth.kml+xml',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    // Validate and store each exclusion zone
    const createdZones = [];
    const validationErrors = [];

    for (const parsedZone of parsedZones) {
      try {
        // Validate zone is within property boundary
        const validation = validateZoneWithinBoundary(
          parsedZone.geometry,
          propertyBoundary.geometry as unknown as Polygon,
          { tolerance: 1.0 }
        );

        if (!validation.valid) {
          validationErrors.push({
            zoneName: parsedZone.name,
            error: validation.error,
          });
          continue; // Skip invalid zones
        }

        // Calculate zone area
        const zonePoly = turf.polygon(parsedZone.geometry.coordinates);
        const areaSquareMeters = turf.area(zonePoly);
        const areaAcres = areaSquareMeters / 4046.86;

        // Apply buffer if needed for zone type
        const bufferDistance = getDefaultBufferDistance(parsedZone.type);
        let bufferedGeometry: Polygon | null = null;

        if (bufferDistance > 0) {
          bufferedGeometry = applyZoneBuffer(
            parsedZone.geometry,
            parsedZone.type,
            { distance: bufferDistance }
          );
        }

        // Store exclusion zone in database
        const zone = await prisma.exclusionZone.create({
          data: {
            projectId,
            propertyBoundaryId: propertyBoundary.id,
            fileId: uploadedFile.id,
            createdBy: userId,
            name: parsedZone.name,
            type: parsedZone.type,
            description: parsedZone.description,
            geometry: parsedZone.geometry as any,
            bufferDistance,
            bufferedGeometry: bufferedGeometry as any,
            attributes: parsedZone.attributes || {},
            areaSquareMeters,
            areaAcres,
          },
        });

        createdZones.push({
          id: zone.id,
          name: zone.name,
          type: zone.type,
          areaAcres: zone.areaAcres.toFixed(2),
          bufferDistance,
        });
      } catch (error) {
        validationErrors.push({
          zoneName: parsedZone.name,
          error:
            error instanceof Error ? error.message : 'Unknown validation error',
        });
      }
    }

    // Recalculate buildable area
    let buildableArea;
    try {
      buildableArea = await calculateAndSaveBuildableArea(projectId);
    } catch (error) {
      console.error('Failed to calculate buildable area:', error);
      // Don't fail the entire request if buildable area calculation fails
    }

    // Mark file as processed
    await prisma.uploadedFile.update({
      where: { id: uploadedFile.id },
      data: { processedAt: new Date() },
    });

    return NextResponse.json({
      success: true,
      data: {
        fileId: uploadedFile.id,
        zonesCreated: createdZones.length,
        zones: createdZones,
        validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
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
    console.error('Exclusion zone upload error:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to process exclusion zone upload',
      },
      { status: 500 }
    );
  }
}
