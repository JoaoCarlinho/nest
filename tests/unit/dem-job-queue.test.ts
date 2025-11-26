import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEMJobQueue, createDEMJobQueue } from '@/lib/terrain/dem-job-queue';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

// Mock AWS SDK
vi.mock('@aws-sdk/client-sqs');

describe('DEMJobQueue', () => {
  const mockQueueUrl = 'https://sqs.us-west-2.amazonaws.com/123456789/nest-dem-processing';
  const mockRegion = 'us-west-2';

  let jobQueue: DEMJobQueue;
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    mockSend = vi.fn().mockResolvedValue({ MessageId: 'mock-message-id-123' });
    (SQSClient as any).mockImplementation(() => ({
      send: mockSend,
    }));

    jobQueue = new DEMJobQueue({
      queueUrl: mockQueueUrl,
      region: mockRegion,
    });
  });

  describe('enqueueJob', () => {
    it('should enqueue a DEM job successfully', async () => {
      const payload = {
        jobId: 'job-123',
        projectId: 'proj-456',
        propertyBoundaryId: 'boundary-789',
        resolution: 1.0,
        interpolationMethod: 'tin' as const,
        bounds: {
          minLat: 37.7,
          maxLat: 37.8,
          minLng: -122.5,
          maxLng: -122.4,
        },
      };

      const messageId = await jobQueue.enqueueJob(payload);

      expect(messageId).toBe('mock-message-id-123');
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend.mock.calls[0][0]).toBeInstanceOf(SendMessageCommand);
    });

    it('should send correct payload format', async () => {
      const payload = {
        jobId: 'job-123',
        projectId: 'proj-456',
        propertyBoundaryId: 'boundary-789',
        resolution: 2.0,
        interpolationMethod: 'idw' as const,
        bounds: {
          minLat: 37.7,
          maxLat: 37.8,
          minLng: -122.5,
          maxLng: -122.4,
        },
      };

      await jobQueue.enqueueJob(payload);

      // Verify SQS send was called with a SendMessageCommand
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend.mock.calls[0][0]).toBeInstanceOf(SendMessageCommand);
    });

    it('should throw error if MessageId is missing', async () => {
      mockSend.mockResolvedValue({});

      const payload = {
        jobId: 'job-123',
        projectId: 'proj-456',
        propertyBoundaryId: 'boundary-789',
        resolution: 1.0,
        interpolationMethod: 'tin' as const,
        bounds: {
          minLat: 37.7,
          maxLat: 37.8,
          minLng: -122.5,
          maxLng: -122.4,
        },
      };

      await expect(jobQueue.enqueueJob(payload)).rejects.toThrow('Failed to enqueue DEM generation job');
    });

    it('should handle SQS errors', async () => {
      mockSend.mockRejectedValue(new Error('SQS service error'));

      const payload = {
        jobId: 'job-123',
        projectId: 'proj-456',
        propertyBoundaryId: 'boundary-789',
        resolution: 1.0,
        interpolationMethod: 'tin' as const,
        bounds: {
          minLat: 37.7,
          maxLat: 37.8,
          minLng: -122.5,
          maxLng: -122.4,
        },
      };

      await expect(jobQueue.enqueueJob(payload)).rejects.toThrow('SQS queue error');
    });
  });

  describe('estimateProcessingTime', () => {
    it('should estimate time for small site (1m resolution)', () => {
      const bounds = {
        minLat: 37.77,
        maxLat: 37.78,
        minLng: -122.42,
        maxLng: -122.41,
      };

      const time = jobQueue.estimateProcessingTime(1.0, bounds);

      expect(time).toBeGreaterThan(30); // At least overhead
      expect(time).toBeLessThan(120); // Should be under 2 minutes for small site
    });

    it('should estimate longer time for large site (1m resolution)', () => {
      const bounds = {
        minLat: 37.7,
        maxLat: 37.9,
        minLng: -122.5,
        maxLng: -122.3,
      };

      const time = jobQueue.estimateProcessingTime(1.0, bounds);

      expect(time).toBeGreaterThan(60); // Larger sites take longer
    });

    it('should estimate shorter time for coarser resolution', () => {
      const bounds = {
        minLat: 37.7,
        maxLat: 37.9,
        minLng: -122.5,
        maxLng: -122.3,
      };

      const time1m = jobQueue.estimateProcessingTime(1.0, bounds);
      const time5m = jobQueue.estimateProcessingTime(5.0, bounds);

      expect(time5m).toBeLessThan(time1m);
    });
  });
});

describe('createDEMJobQueue', () => {
  it('should create queue from environment variables', () => {
    process.env.AWS_SQS_DEM_QUEUE_URL = 'https://sqs.us-west-2.amazonaws.com/test';
    process.env.AWS_REGION = 'us-west-2';

    const queue = createDEMJobQueue();

    expect(queue).toBeInstanceOf(DEMJobQueue);
  });

  it('should throw error if queue URL is missing', () => {
    delete process.env.AWS_SQS_DEM_QUEUE_URL;

    expect(() => createDEMJobQueue()).toThrow('AWS_SQS_DEM_QUEUE_URL environment variable is required');
  });
});
