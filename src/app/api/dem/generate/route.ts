/**
 * POST /api/dem/generate
 *
 * Enqueue DEM generation job for processing via AWS Lambda.
 * Creates job record in database and sends message to SQS queue.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { TerrainAnalysisError } from '@/lib/errors/TerrainAnalysisError';
import { createDEMJobQueue } from '@/lib/terrain/dem-job-queue';

export const runtime = 'nodejs';
export const maxDuration = 60; // 60 seconds max for API route

interface GenerateDEMRequest {
  projectId: string;
  propertyBoundaryId: string;
  resolution?: number; // meters (default 1.0)
  interpolationMethod?: 'tin' | 'idw' | 'kriging'; // default 'tin'
}

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body: GenerateDEMRequest = await request.json();
    const { projectId, propertyBoundaryId, resolution = 1.0, interpolationMethod = 'tin' } = body;

    // Validate required fields
    if (!projectId || !propertyBoundaryId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Missing required fields: projectId, propertyBoundaryId',
          },
        },
        { status: 400 }
      );
    }

    // Validate resolution
    const validResolutions = [0.5, 1.0, 2.0, 5.0];
    if (!validResolutions.includes(resolution)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid resolution. Must be one of: ${validResolutions.join(', ')}`,
          },
        },
        { status: 400 }
      );
    }

    // Validate interpolation method
    const validMethods = ['tin', 'idw', 'kriging'];
    if (!validMethods.includes(interpolationMethod)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid interpolation method. Must be one of: ${validMethods.join(', ')}`,
          },
        },
        { status: 400 }
      );
    }

    // Check if property boundary exists
    const propertyBoundary = await prisma.propertyBoundary.findUnique({
      where: { id: propertyBoundaryId },
      select: {
        id: true,
        centroidLat: true,
        centroidLng: true,
        areaSquareMeters: true,
      },
    });

    if (!propertyBoundary) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Property boundary not found',
            details: { propertyBoundaryId },
          },
        },
        { status: 404 }
      );
    }

    // Check if contour data exists
    const contourCount = await prisma.contourLine.count({
      where: { projectId, propertyBoundaryId },
    });

    if (contourCount === 0) {
      throw new TerrainAnalysisError('Cannot generate DEM - no contour data available', {
        projectId,
        propertyBoundaryId,
        requiredStory: '1.3 - Topographic Contour Data Import',
        suggestion: 'Import contour data before generating DEM',
      });
    }

    // Calculate bounds from property boundary
    // TODO: Query actual geometry bounds from PostGIS
    // For now, use approximate bounds based on area
    const approxSizeKm = Math.sqrt(propertyBoundary.areaSquareMeters / 1000000);
    const latOffset = approxSizeKm / 111; // 1 degree lat ≈ 111km
    const lngOffset = approxSizeKm / (111 * Math.cos(propertyBoundary.centroidLat * Math.PI / 180));

    const bounds = {
      minLat: propertyBoundary.centroidLat - latOffset / 2,
      maxLat: propertyBoundary.centroidLat + latOffset / 2,
      minLng: propertyBoundary.centroidLng - lngOffset / 2,
      maxLng: propertyBoundary.centroidLng + lngOffset / 2,
    };

    // Create job record
    const job = await prisma.dEMProcessingJob.create({
      data: {
        projectId,
        propertyBoundaryId,
        resolution,
        interpolationMethod,
        status: 'queued',
        progress: 0,
      },
    });

    // Enqueue job to SQS
    const jobQueue = createDEMJobQueue();
    const messageId = await jobQueue.enqueueJob({
      jobId: job.id,
      projectId,
      propertyBoundaryId,
      resolution,
      interpolationMethod,
      bounds,
    });

    // Estimate processing time
    const estimatedTime = jobQueue.estimateProcessingTime(resolution, bounds);

    return NextResponse.json({
      success: true,
      data: {
        jobId: job.id,
        sqsMessageId: messageId,
        status: 'queued',
        projectId,
        resolution,
        interpolationMethod,
        contourCount,
        estimatedTime,
      },
    });
  } catch (error) {
    console.error('DEM generation error:', error);

    if (error instanceof TerrainAnalysisError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to enqueue DEM generation job',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
      },
      { status: 500 }
    );
  }
}
