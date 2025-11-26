import { AppError } from './AppError';

/**
 * Error class for geospatial operations
 * Used for boundary parsing, geometry validation, coordinate errors
 */
export class GeospatialError extends AppError {
  constructor(
    message: string,
    details?: {
      fileId?: string;
      coordinates?: any;
      intersectionPoints?: any;
      line?: number;
      expected?: string;
      received?: string;
      expectedElements?: string[];
      [key: string]: any;
    }
  ) {
    super(message, 'GEOSPATIAL_ERROR', 400, details);
  }
}
