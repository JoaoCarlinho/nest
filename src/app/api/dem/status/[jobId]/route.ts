/**
 * GET /api/dem/status/:jobId
 *
 * Poll DEM generation job status.
 * Returns current job status, progress, and estimated time remaining.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

interface RouteParams {
  params: {
    jobId: string;
  };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { jobId } = params;

    // Fetch job from database
    const job = await prisma.dEMProcessingJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        projectId: true,
        status: true,
        progress: true,
        errorMessage: true,
        queuedAt: true,
        startedAt: true,
        completedAt: true,
        processingTime: true,
        resolution: true,
        interpolationMethod: true,
        demId: true,
      },
    });

    if (!job) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Job not found',
            details: { jobId },
          },
        },
        { status: 404 }
      );
    }

    // Calculate estimated time remaining
    let estimatedTimeRemaining: number | undefined;

    if (job.status === 'processing' && job.startedAt) {
      const elapsedSeconds = Math.floor(
        (Date.now() - new Date(job.startedAt).getTime()) / 1000
      );

      // Rough estimate based on progress
      if (job.progress > 0 && job.progress < 100) {
        const totalEstimatedTime = (elapsedSeconds / job.progress) * 100;
        estimatedTimeRemaining = Math.max(0, Math.ceil(totalEstimatedTime - elapsedSeconds));
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        jobId: job.id,
        projectId: job.projectId,
        status: job.status,
        progress: job.progress,
        errorMessage: job.errorMessage,
        queuedAt: job.queuedAt.toISOString(),
        startedAt: job.startedAt?.toISOString(),
        completedAt: job.completedAt?.toISOString(),
        processingTime: job.processingTime,
        resolution: job.resolution,
        interpolationMethod: job.interpolationMethod,
        demId: job.demId,
        estimatedTimeRemaining,
      },
    });
  } catch (error) {
    console.error('Job status fetch error:', error);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch job status',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
      },
      { status: 500 }
    );
  }
}
