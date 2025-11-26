/**
 * DEM Generation Job Queue
 *
 * Handles enqueueing and dequ

eueing DEM generation jobs via AWS SQS.
 * Jobs are processed by Lambda function with Python + GDAL.
 */

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { TerrainAnalysisError } from '@/lib/errors/TerrainAnalysisError';

export interface DEMJobPayload {
  jobId: string;
  projectId: string;
  propertyBoundaryId: string;
  resolution: number; // meters
  interpolationMethod: 'tin' | 'idw' | 'kriging';
  bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
}

export interface DEMJobQueueConfig {
  queueUrl: string;
  region: string;
}

/**
 * DEM Job Queue Client
 * Manages SQS queue for DEM generation jobs
 */
export class DEMJobQueue {
  private sqsClient: SQSClient;
  private queueUrl: string;

  constructor(config: DEMJobQueueConfig) {
    this.queueUrl = config.queueUrl;
    this.sqsClient = new SQSClient({ region: config.region });
  }

  /**
   * Enqueue a DEM generation job
   * @param payload - Job payload for Lambda processing
   * @returns SQS message ID
   */
  async enqueueJob(payload: DEMJobPayload): Promise<string> {
    try {
      const command = new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(payload),
        MessageAttributes: {
          JobType: {
            DataType: 'String',
            StringValue: 'dem-generation',
          },
          ProjectId: {
            DataType: 'String',
            StringValue: payload.projectId,
          },
          Resolution: {
            DataType: 'Number',
            StringValue: payload.resolution.toString(),
          },
        },
      });

      const response = await this.sqsClient.send(command);

      if (!response.MessageId) {
        throw new TerrainAnalysisError('Failed to enqueue DEM generation job', {
          projectId: payload.projectId,
          queueUrl: this.queueUrl,
        });
      }

      return response.MessageId;
    } catch (error) {
      if (error instanceof TerrainAnalysisError) {
        throw error;
      }

      throw new TerrainAnalysisError(
        'SQS queue error - failed to enqueue DEM job',
        {
          projectId: payload.projectId,
          queueUrl: this.queueUrl,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
    }
  }

  /**
   * Estimate processing time based on resolution and site size
   * @param resolution - Grid resolution in meters
   * @param bounds - Geographic bounds
   * @returns Estimated time in seconds
   */
  estimateProcessingTime(resolution: number, bounds: DEMJobPayload['bounds']): number {
    // Calculate approximate grid size
    const latRange = bounds.maxLat - bounds.minLat;
    const lngRange = bounds.maxLng - bounds.minLng;

    // Rough conversion: 1 degree latitude ≈ 111km
    const heightKm = latRange * 111;
    const widthKm = lngRange * 111 * Math.cos((bounds.minLat + bounds.maxLat) / 2 * Math.PI / 180);

    const areaKm2 = heightKm * widthKm;
    const resolutionKm = resolution / 1000;
    const pixelCount = (heightKm / resolutionKm) * (widthKm / resolutionKm);

    // Estimate: ~100,000 pixels per second for TIN interpolation
    const baseTime = pixelCount / 100000;

    // Add overhead for data retrieval, validation, upload (30 seconds)
    const overhead = 30;

    return Math.ceil(baseTime + overhead);
  }
}

/**
 * Create DEM job queue client from environment variables
 */
export function createDEMJobQueue(): DEMJobQueue {
  const queueUrl = process.env.AWS_SQS_DEM_QUEUE_URL;
  const region = process.env.AWS_REGION || 'us-west-2';

  if (!queueUrl) {
    throw new Error('AWS_SQS_DEM_QUEUE_URL environment variable is required');
  }

  return new DEMJobQueue({ queueUrl, region });
}
