import { XMLParser } from 'fast-xml-parser';
import { GeospatialError } from '../errors/FileUploadError';

export interface ValidationError {
  line?: number;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
}

/**
 * Validate KML content against KML 2.2 structure requirements
 * @param kmlContent - KML XML content as string
 * @returns Validation result with errors if invalid
 */
export function validateKML(kmlContent: string): ValidationResult {
  const errors: ValidationError[] = [];

  // Step 1: Parse XML
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
  });

  let parsedKML: any;
  try {
    parsedKML = parser.parse(kmlContent);
  } catch (error) {
    return {
      valid: false,
      errors: [
        {
          message: `Invalid XML structure: ${
            error instanceof Error ? error.message : 'Malformed XML'
          }`,
        },
      ],
    };
  }

  // Step 2: Validate KML root element
  if (!parsedKML.kml) {
    errors.push({
      message: 'Missing root <kml> element. File must be valid KML format.',
    });
    // Return early if no KML root - can't validate further
    return {
      valid: false,
      errors,
    };
  }

  // Step 3: Check for KML namespace
  const kml = parsedKML.kml;
  if (kml && !kml['@_xmlns']?.includes('opengis.net/kml')) {
    errors.push({
      message:
        'Missing or invalid KML namespace. Expected xmlns="http://www.opengis.net/kml/2.2"',
    });
  }

  // Step 4: Validate Document or Placemark exists
  if (kml && !kml.Document && !kml.Placemark) {
    errors.push({
      message:
        'KML must contain at least one <Document> or <Placemark> element.',
    });
  }

  // Step 5: Validate Placemarks have coordinates
  const placemarks = extractPlacemarks(kml);

  if (placemarks.length === 0) {
    errors.push({
      message:
        'No valid <Placemark> elements found. KML must contain at least one Placemark with geometry.',
    });
  }

  // Step 6: Validate coordinates in each Placemark
  placemarks.forEach((placemark, index) => {
    const coordinateErrors = validatePlacemarkCoordinates(placemark, index);
    errors.push(...coordinateErrors);
  });

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Extract all Placemark elements from KML structure
 */
function extractPlacemarks(kml: any): any[] {
  const placemarks: any[] = [];

  // Placemarks can be directly under <kml> or under <Document>
  if (kml.Placemark) {
    placemarks.push(
      ...(Array.isArray(kml.Placemark) ? kml.Placemark : [kml.Placemark])
    );
  }

  if (kml.Document) {
    const doc = Array.isArray(kml.Document) ? kml.Document[0] : kml.Document;
    if (doc.Placemark) {
      placemarks.push(
        ...(Array.isArray(doc.Placemark) ? doc.Placemark : [doc.Placemark])
      );
    }
    // Handle Folder structures
    if (doc.Folder) {
      const folders = Array.isArray(doc.Folder) ? doc.Folder : [doc.Folder];
      folders.forEach((folder) => {
        if (folder.Placemark) {
          placemarks.push(
            ...(Array.isArray(folder.Placemark)
              ? folder.Placemark
              : [folder.Placemark])
          );
        }
      });
    }
  }

  return placemarks;
}

/**
 * Validate coordinates in a Placemark
 */
function validatePlacemarkCoordinates(
  placemark: any,
  index: number
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Extract geometry (Point, LineString, Polygon, MultiGeometry)
  const geometryTypes = [
    'Point',
    'LineString',
    'Polygon',
    'LinearRing',
    'MultiGeometry',
  ];

  let hasGeometry = false;
  let coordinates: string | undefined;

  for (const geomType of geometryTypes) {
    if (placemark[geomType]) {
      hasGeometry = true;

      if (geomType === 'Polygon') {
        // Polygons have outerBoundaryIs/LinearRing structure
        const boundary =
          placemark.Polygon.outerBoundaryIs || placemark.Polygon.LinearRing;
        if (boundary?.LinearRing?.coordinates || boundary?.coordinates) {
          coordinates =
            boundary.LinearRing?.coordinates || boundary.coordinates;
        }
      } else if (geomType === 'MultiGeometry') {
        // Skip detailed MultiGeometry validation for now
        return errors;
      } else {
        coordinates = placemark[geomType].coordinates;
      }

      break;
    }
  }

  if (!hasGeometry) {
    errors.push({
      message: `Placemark #${index + 1} has no geometry (Point, LineString, or Polygon).`,
    });
    return errors;
  }

  if (!coordinates) {
    errors.push({
      message: `Placemark #${index + 1} is missing <coordinates> element.`,
    });
    return errors;
  }

  // Validate coordinate format and ranges
  const coordErrors = validateCoordinateValues(coordinates, index);
  errors.push(...coordErrors);

  return errors;
}

/**
 * Validate coordinate values are numeric and within valid ranges
 * Expected format: "longitude,latitude,altitude" (space or newline separated tuples)
 */
function validateCoordinateValues(
  coordinatesStr: string,
  placemarkIndex: number
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Split by whitespace (space, newline, tab)
  const coordTuples = coordinatesStr.trim().split(/\s+/);

  coordTuples.forEach((tuple, tupleIndex) => {
    const parts = tuple.split(',');

    if (parts.length < 2) {
      errors.push({
        message: `Placemark #${placemarkIndex + 1}, coordinate tuple #${tupleIndex + 1}: Invalid format. Expected "longitude,latitude[,altitude]".`,
      });
      return;
    }

    const [lngStr, latStr] = parts;

    // Validate longitude
    const lng = parseFloat(lngStr);
    if (isNaN(lng)) {
      errors.push({
        message: `Placemark #${placemarkIndex + 1}, coordinate #${tupleIndex + 1}: Longitude "${lngStr}" is not a valid number.`,
      });
    } else if (lng < -180 || lng > 180) {
      errors.push({
        message: `Placemark #${placemarkIndex + 1}, coordinate #${tupleIndex + 1}: Longitude ${lng} out of range [-180, 180].`,
      });
    }

    // Validate latitude
    const lat = parseFloat(latStr);
    if (isNaN(lat)) {
      errors.push({
        message: `Placemark #${placemarkIndex + 1}, coordinate #${tupleIndex + 1}: Latitude "${latStr}" is not a valid number.`,
      });
    } else if (lat < -90 || lat > 90) {
      errors.push({
        message: `Placemark #${placemarkIndex + 1}, coordinate #${tupleIndex + 1}: Latitude ${lat} out of range [-90, 90].`,
      });
    }
  });

  return errors;
}

/**
 * Validate and throw error if KML is invalid
 * @param kmlContent - KML content string
 * @throws GeospatialError if validation fails
 */
export function validateKMLOrThrow(kmlContent: string): void {
  const result = validateKML(kmlContent);

  if (!result.valid) {
    throw new GeospatialError('KML validation failed', {
      format: 'kml',
      validationErrors: result.errors,
    });
  }
}
