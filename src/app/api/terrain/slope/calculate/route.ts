import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { TerrainAnalysisError } from '@/lib/errors/TerrainAnalysisError';
import { apiResponse } from '@/lib/utils/response';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

// AWS SQS client
const sqsClient = new SQSClient({
  region: process.env.AWS_REGION || 'us-west-2'
});

const SLOPE_QUEUE_URL = process.env.SLOPE_CALCULATOR_QUEUE_URL;

/**
 * POST /api/terrain/slope/calculate
 * Trigger slope calculation for a project
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      projectId,
      smoothingEnabled = false,
      smoothingKernelSize = 3,
      maxBuildableSlope = 15.0,
      flatThreshold = 5.0,
      moderateThreshold = 15.0,
      steepThreshold = 25.0
    } = body;

    // Validate required parameters
    if (!projectId) {
      return apiResponse(
        { error: 'projectId is required' },
        { status: 400 }
      );
    }

    // Validate thresholds
    if (flatThreshold >= moderateThreshold || moderateThreshold >= steepThreshold) {
      return apiResponse(
        { error: 'Thresholds must be increasing: flatThreshold < moderateThreshold < steepThreshold' },
        { status: 400 }
      );
    }

    if (maxBuildableSlope < 0 || maxBuildableSlope > 100) {
      return apiResponse(
        { error: 'maxBuildableSlope must be between 0 and 100' },
        { status: 400 }
      );
    }

    // Check if project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        digitalElevationModel: true,
        propertyBoundaries: true
      }
    });

    if (!project) {
      return apiResponse(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    // Check if DEM exists (prerequisite from Story 1.4)
    if (!project.digitalElevationModel) {
      throw new TerrainAnalysisError(
        'Elevation grid (DEM) required before calculating slope',
        {
          projectId,
          requiredStory: '1.4 - Elevation Grid Generation',
          suggestion: 'Import contour data and generate DEM first'
        }
      );
    }

    const dem = project.digitalElevationModel;
    const propertyBoundary = project.propertyBoundaries[0];

    if (!propertyBoundary) {
      return apiResponse(
        { error: 'Property boundary not found for project' },
        { status: 404 }
      );
    }

    // Check if slope analysis already exists
    const existingAnalysis = await prisma.slopeAnalysis.findUnique({
      where: { projectId }
    });

    if (existingAnalysis) {
      // Delete existing analysis to allow recalculation
      await prisma.slopeAnalysis.delete({
        where: { projectId }
      });
    }

    // Enqueue slope calculation job via SQS
    const message = {
      projectId,
      demId: dem.id,
      propertyBoundaryId: propertyBoundary.id,
      smoothingEnabled,
      smoothingKernelSize,
      maxBuildableSlope,
      flatThreshold,
      moderateThreshold,
      steepThreshold
    };

    if (!SLOPE_QUEUE_URL) {
      throw new Error('SLOPE_CALCULATOR_QUEUE_URL environment variable not set');
    }

    const command = new SendMessageCommand({
      QueueUrl: SLOPE_QUEUE_URL,
      MessageBody: JSON.stringify(message)
    });

    await sqsClient.send(command);

    console.log(`Slope calculation queued for project ${projectId}`);

    return apiResponse({
      success: true,
      message: 'Slope calculation started',
      data: {
        projectId,
        demId: dem.id,
        status: 'processing',
        parameters: {
          smoothingEnabled,
          smoothingKernelSize: smoothingEnabled ? smoothingKernelSize : null,
          maxBuildableSlope,
          thresholds: {
            flat: flatThreshold,
            moderate: moderateThreshold,
            steep: steepThreshold
          }
        }
      }
    });

  } catch (error) {
    console.error('Slope calculation trigger failed:', error);

    if (error instanceof TerrainAnalysisError) {
      return apiResponse(
        {
          error: error.message,
          details: error.details
        },
        { status: 400 }
      );
    }

    return apiResponse(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
