import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getObject } from '@/lib/storage/s3-client';
import { KMLBoundaryParser } from '@/lib/geospatial/kml-boundary-parser';
import { GeometryValidator } from '@/lib/geospatial/geometry-validator';
import { GeospatialError } from '@/lib/errors/GeospatialError';
import { AppError } from '@/lib/errors/AppError';
import { Polygon } from 'geojson';

const prisma = new PrismaClient();

/**
 * Parse property boundary from uploaded KML file
 * POST /api/boundaries/parse
 * Request body: { fileId: string, projectId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fileId, projectId } = body;

    // Validate request
    if (!fileId || typeof fileId !== 'string') {
      return errorResponse('Missing or invalid fileId', 'INVALID_REQUEST', 400);
    }

    if (!projectId || typeof projectId !== 'string') {
      return errorResponse('Missing or invalid projectId', 'INVALID_REQUEST', 400);
    }

    // Retrieve uploaded file metadata
    const uploadedFile = await prisma.uploadedFile.findUnique({
      where: { id: fileId },
    });

    if (!uploadedFile) {
      return errorResponse('Uploaded file not found', 'FILE_NOT_FOUND', 404);
    }

    // Check if boundary already exists for this file
    const existingBoundary = await prisma.propertyBoundary.findUnique({
      where: { fileId },
    });

    if (existingBoundary) {
      return errorResponse(
        'Boundary already parsed for this file',
        'BOUNDARY_ALREADY_EXISTS',
        409
      );
    }

    // Verify project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return errorResponse('Project not found', 'PROJECT_NOT_FOUND', 404);
    }

    // Retrieve KML content from S3
    const kmlBuffer = await getObject(uploadedFile.storedName);
    const kmlContent = kmlBuffer.toString('utf-8');

    // Parse boundary from KML
    const parser = new KMLBoundaryParser();
    const geometry = parser.parse(kmlContent, fileId);

    // Validate geometry
    const validator = new GeometryValidator();
    validator.validatePolygon(geometry, fileId);

    // Calculate geometric properties
    const areaSquareMeters = validator.calculateArea(geometry);
    const areaAcres = validator.convertToAcres(areaSquareMeters);
    const areaHectares = validator.convertToHectares(areaSquareMeters);
    const perimeterMeters = validator.calculatePerimeter(geometry);
    const centroid = validator.calculateCentroid(geometry);

    // Convert GeoJSON Polygon to PostGIS-compatible format
    // PostGIS expects WKT or GeoJSON string
    const geometryGeoJSON = JSON.stringify(geometry);

    // Store boundary in database
    // Note: For PostGIS geometry columns, we need to use raw SQL
    // Prisma doesn't support PostGIS geometry types directly
    const boundaryId = await createBoundaryWithPostGIS(
      projectId,
      fileId,
      geometry,
      areaSquareMeters,
      areaAcres,
      areaHectares,
      perimeterMeters,
      centroid
    );

    // Update uploaded file as processed
    await prisma.uploadedFile.update({
      where: { id: fileId },
      data: { processedAt: new Date() },
    });

    // Return parsed boundary with metadata
    return NextResponse.json(
      {
        success: true,
        data: {
          boundaryId,
          geometry,
          properties: {
            areaSquareMeters,
            areaAcres,
            areaHectares,
            perimeterMeters,
            centroid,
          },
          projectId,
          fileId,
          parsedAt: new Date().toISOString(),
        },
        timestamp: new Date().toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof GeospatialError || error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    console.error('Error parsing boundary:', error);
    return errorResponse(
      'Failed to parse boundary',
      'INTERNAL_SERVER_ERROR',
      500,
      error instanceof Error ? { error: error.message } : undefined
    );
  }
}

/**
 * Create property boundary with PostGIS geometry using raw SQL
 */
async function createBoundaryWithPostGIS(
  projectId: string,
  fileId: string,
  geometry: Polygon,
  areaSquareMeters: number,
  areaAcres: number,
  areaHectares: number,
  perimeterMeters: number,
  centroid: { lat: number; lng: number }
): Promise<string> {
  const boundaryId = crypto.randomUUID();

  // Convert GeoJSON to WKT for PostGIS
  // PostGIS ST_GeomFromGeoJSON can parse GeoJSON directly
  const geometryGeoJSON = JSON.stringify(geometry);

  await prisma.$executeRaw`
    INSERT INTO "PropertyBoundary" (
      id, "projectId", "fileId", geometry,
      "areaSquareMeters", "areaAcres", "areaHectares",
      "perimeterMeters", "centroidLat", "centroidLng",
      "parsedAt"
    )
    VALUES (
      ${boundaryId}, ${projectId}, ${fileId},
      ST_GeomFromGeoJSON(${geometryGeoJSON}),
      ${areaSquareMeters}, ${areaAcres}, ${areaHectares},
      ${perimeterMeters}, ${centroid.lat}, ${centroid.lng},
      NOW()
    )
  `;

  return boundaryId;
}

/**
 * Helper function to create error responses
 */
function errorResponse(
  message: string,
  code: string,
  status: number,
  details?: Record<string, any>
) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
        details,
      },
      timestamp: new Date().toISOString(),
    },
    { status }
  );
}
