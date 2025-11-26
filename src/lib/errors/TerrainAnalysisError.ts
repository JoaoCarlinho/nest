import { AppError } from './AppError';

/**
 * Error class for terrain analysis operations
 * Used for contour parsing, elevation validation, terrain statistics
 */
export class TerrainAnalysisError extends AppError {
  constructor(
    message: string,
    details?: {
      projectId?: string;
      fileId?: string;
      format?: string;
      availableFields?: string[];
      expectedFields?: string[];
      invalidValues?: any[];
      [key: string]: any;
    }
  ) {
    super(message, 'TERRAIN_ANALYSIS_ERROR', 500, details);
  }
}
