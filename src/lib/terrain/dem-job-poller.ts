/**
 * DEM Job Polling Utility
 *
 * Client-side utility for polling DEM generation job status.
 * Implements exponential backoff and timeout handling.
 */

export interface JobStatus {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number; // 0-100
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  estimatedTimeRemaining?: number; // seconds
}

export interface DEMJobPollerConfig {
  /**
   * Initial polling interval in milliseconds
   * @default 2000 (2 seconds)
   */
  initialInterval?: number;

  /**
   * Maximum polling interval in milliseconds
   * @default 10000 (10 seconds)
   */
  maxInterval?: number;

  /**
   * Maximum total polling time in milliseconds
   * @default 300000 (5 minutes)
   */
  timeout?: number;

  /**
   * Backoff multiplier for increasing interval
   * @default 1.5
   */
  backoffMultiplier?: number;
}

export type JobStatusCallback = (status: JobStatus) => void;
export type JobCompleteCallback = (status: JobStatus) => void;
export type JobErrorCallback = (error: Error) => void;
export type JobTimeoutCallback = () => void;

/**
 * DEM Job Poller
 * Polls job status endpoint until completion or timeout
 */
export class DEMJobPoller {
  private config: Required<DEMJobPollerConfig>;
  private pollingInterval?: ReturnType<typeof setTimeout>;
  private startTime?: number;
  private currentInterval: number;

  constructor(config: DEMJobPollerConfig = {}) {
    this.config = {
      initialInterval: config.initialInterval ?? 2000,
      maxInterval: config.maxInterval ?? 10000,
      timeout: config.timeout ?? 300000,
      backoffMultiplier: config.backoffMultiplier ?? 1.5,
    };
    this.currentInterval = this.config.initialInterval;
  }

  /**
   * Start polling for job status
   * @param jobId - Job ID to poll
   * @param callbacks - Callback functions for status updates
   */
  async startPolling(
    jobId: string,
    callbacks: {
      onStatus?: JobStatusCallback;
      onComplete?: JobCompleteCallback;
      onError?: JobErrorCallback;
      onTimeout?: JobTimeoutCallback;
    }
  ): Promise<void> {
    this.startTime = Date.now();
    this.currentInterval = this.config.initialInterval;

    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          // Check timeout
          if (this.startTime && Date.now() - this.startTime > this.config.timeout) {
            this.stopPolling();
            callbacks.onTimeout?.();
            resolve();
            return;
          }

          // Fetch job status
          const status = await this.fetchJobStatus(jobId);

          // Notify status callback
          callbacks.onStatus?.(status);

          // Handle completion
          if (status.status === 'completed') {
            this.stopPolling();
            callbacks.onComplete?.(status);
            resolve();
            return;
          }

          // Handle failure
          if (status.status === 'failed') {
            this.stopPolling();
            const error = new Error(status.errorMessage || 'DEM generation failed');
            callbacks.onError?.(error);
            reject(error);
            return;
          }

          // Continue polling with backoff
          this.currentInterval = Math.min(
            this.currentInterval * this.config.backoffMultiplier,
            this.config.maxInterval
          );

          this.pollingInterval = setTimeout(poll, this.currentInterval);
        } catch (error) {
          this.stopPolling();
          const err = error instanceof Error ? error : new Error('Unknown polling error');
          callbacks.onError?.(err);
          reject(err);
        }
      };

      // Start first poll
      poll();
    });
  }

  /**
   * Stop polling
   */
  stopPolling(): void {
    if (this.pollingInterval) {
      clearTimeout(this.pollingInterval);
      this.pollingInterval = undefined;
    }
  }

  /**
   * Fetch job status from API
   * @param jobId - Job ID
   * @returns Job status
   */
  private async fetchJobStatus(jobId: string): Promise<JobStatus> {
    const response = await fetch(`/api/dem/status/${jobId}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch job status: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error?.message || 'Failed to fetch job status');
    }

    return data.data;
  }
}

/**
 * Create a simple promise-based polling function
 * @param jobId - Job ID to poll
 * @param config - Polling configuration
 * @returns Promise that resolves with final job status
 */
export async function pollJobStatus(
  jobId: string,
  config?: DEMJobPollerConfig
): Promise<JobStatus> {
  const poller = new DEMJobPoller(config);

  return new Promise((resolve, reject) => {
    poller.startPolling(jobId, {
      onComplete: resolve,
      onError: reject,
      onTimeout: () => {
        reject(new Error('Job polling timed out after 5 minutes'));
      },
    });
  });
}
