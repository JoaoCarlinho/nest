import { AppError } from './AppError';

/**
 * File Upload Error
 * Thrown when file upload validation or processing fails
 */
export class FileUploadError extends AppError {
  constructor(
    message: string,
    details?: {
      fileType?: string;
      maxSize?: number;
      actualSize?: number;
      validationErrors?: Array<{ line?: number; message: string }>;
      [key: string]: any;
    }
  ) {
    super(message, 'FILE_UPLOAD_ERROR', 400, details);
  }
}

/**
 * Geospatial Data Error
 * Thrown when KML/KMZ processing or validation fails
 */
export class GeospatialError extends AppError {
  constructor(
    message: string,
    details?: {
      format?: string;
      validationErrors?: Array<{ line?: number; message: string }>;
      [key: string]: any;
    }
  ) {
    super(message, 'GEOSPATIAL_ERROR', 400, details);
  }
}
