import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { apiResponse } from '@/lib/utils/response';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const PROFILE_QUEUE_URL = process.env.PROFILE_GENERATION_QUEUE_URL;

/**
 * POST /api/terrain/profile/create
 * Create elevation profile from user-defined line
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      projectId,
      lineCoordinates,
      name = 'Elevation Profile',
      description,
      sampleInterval = 5.0,
      maxGradeThreshold = 8.0,
      userId
    } = body;

    // Validate required fields
    if (!projectId || !lineCoordinates || !userId) {
      return apiResponse(
        { error: 'projectId, lineCoordinates, and userId are required' },
        { status: 400 }
      );
    }

    // Validate line geometry
    if (!Array.isArray(lineCoordinates) || lineCoordinates.length < 2) {
      return apiResponse(
        { error: 'Line must have at least 2 points' },
        { status: 400 }
      );
    }

    // Check if DEM exists
    const dem = await prisma.digitalElevationModel.findUnique({
      where: { projectId }
    });

    if (!dem) {
      return apiResponse(
        {
          error: 'Elevation grid (DEM) required before generating elevation profile',
          details: {
            projectId,
            requiredStory: '1.4 - Elevation Grid Generation'
          }
        },
        { status: 400 }
      );
    }

    // Generate profile ID
    const profileId = `profile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Enqueue profile generation job
    const message = {
      profileId,
      projectId,
      lineCoordinates,
      name,
      description,
      sampleInterval,
      maxGradeThreshold,
      userId
    };

    if (!PROFILE_QUEUE_URL) {
      throw new Error('PROFILE_GENERATION_QUEUE_URL not configured');
    }

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: PROFILE_QUEUE_URL,
        MessageBody: JSON.stringify(message)
      })
    );

    console.log(`Profile generation queued: ${profileId}`);

    return apiResponse({
      success: true,
      data: {
        profileId,
        projectId,
        status: 'processing',
        message: 'Profile generation job queued',
        parameters: {
          name,
          sampleInterval,
          maxGradeThreshold
        }
      }
    });

  } catch (error) {
    console.error('Failed to queue profile generation:', error);

    return apiResponse(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
