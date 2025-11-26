import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

/**
 * Standard API response format
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
  meta: {
    timestamp: string;
    requestId: string;
    cached: boolean;
  };
}

/**
 * Create a successful API response
 */
export function successResponse<T>(data: T, statusCode = 200): NextResponse {
  const response: ApiResponse<T> = {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      requestId: randomUUID(),
      cached: false,
    },
  };

  return NextResponse.json(response, { status: statusCode });
}

/**
 * Create an error API response
 */
export function errorResponse(
  message: string,
  code: string,
  statusCode = 500,
  details?: Record<string, any>
): NextResponse {
  const response: ApiResponse = {
    success: false,
    error: {
      code,
      message,
      details,
    },
    meta: {
      timestamp: new Date().toISOString(),
      requestId: randomUUID(),
      cached: false,
    },
  };

  return NextResponse.json(response, { status: statusCode });
}
