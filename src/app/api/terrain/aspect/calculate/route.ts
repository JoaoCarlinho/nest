import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { apiResponse } from '@/lib/utils/response';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ASPECT_QUEUE_URL = process.env.ASPECT_CALCULATION_QUEUE_URL;

/**
 * POST /api/terrain/aspect/calculate
 * Trigger aspect (orientation) calculation for a project
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      projectId,
      flatAreaThreshold = 2.0
    } = body;

    // Validate required fields
    if (!projectId) {
      return apiResponse(
        { error: 'projectId is required' },
        { status: 400 }
      );
    }

    // Validate flatAreaThreshold
    if (flatAreaThreshold < 0 || flatAreaThreshold > 10) {
      return apiResponse(
        { error: 'flatAreaThreshold must be between 0 and 10 percent' },
        { status: 400 }
      );
    }

    // Check if DEM exists (Story 1.4 prerequisite)
    const dem = await prisma.digitalElevationModel.findUnique({
      where: { projectId }
    });

    if (!dem) {
      return apiResponse(
        {
          error: 'Elevation grid (DEM) required before calculating aspect',
          details: {
            projectId,
            requiredStory: '1.4 - Elevation Grid Generation'
          }
        },
        { status: 400 }
      );
    }

    // Check if slope analysis exists (Story 2.1 prerequisite)
    const slopeAnalysis = await prisma.slopeAnalysis.findUnique({
      where: { projectId }
    });

    if (!slopeAnalysis) {
      return apiResponse(
        {
          error: 'Slope analysis required before calculating aspect (to identify flat areas)',
          details: {
            projectId,
            requiredStory: '2.1 - Slope Calculation'
          }
        },
        { status: 400 }
      );
    }

    // Enqueue aspect calculation job
    const message = {
      projectId,
      flatAreaThreshold
    };

    if (!ASPECT_QUEUE_URL) {
      throw new Error('ASPECT_CALCULATION_QUEUE_URL not configured');
    }

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: ASPECT_QUEUE_URL,
        MessageBody: JSON.stringify(message)
      })
    );

    console.log(`Aspect calculation queued for project: ${projectId}`);

    return apiResponse({
      success: true,
      data: {
        projectId,
        status: 'processing',
        message: 'Aspect calculation job queued',
        parameters: {
          flatAreaThreshold
        }
      }
    });

  } catch (error) {
    console.error('Failed to queue aspect calculation:', error);

    return apiResponse(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
