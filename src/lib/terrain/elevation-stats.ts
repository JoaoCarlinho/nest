/**
 * Elevation statistics and unit detection utilities
 */

export interface ElevationStats {
  min: number;
  max: number;
  avg: number;
  range: number;
  unit: 'meters' | 'feet';
}

/**
 * Calculate elevation statistics from array of elevation values
 * @param elevations - Array of elevation values
 * @returns Statistics object with min, max, avg, range, and detected unit
 */
export function calculateElevationStats(elevations: number[]): ElevationStats {
  if (elevations.length === 0) {
    return {
      min: 0,
      max: 0,
      avg: 0,
      range: 0,
      unit: 'meters',
    };
  }

  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const avg = elevations.reduce((sum, val) => sum + val, 0) / elevations.length;
  const range = max - min;
  const unit = detectElevationUnit(elevations);

  return { min, max, avg, range, unit };
}

/**
 * Detect if elevations are in feet or meters based on range heuristic
 * US terrain data typically uses feet (USGS), international data uses meters
 * Heuristic: if range > 300, likely in feet
 * @param elevations - Array of elevation values
 * @returns 'feet' or 'meters'
 */
export function detectElevationUnit(elevations: number[]): 'feet' | 'meters' {
  if (elevations.length === 0) return 'meters';

  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const range = max - min;

  // If elevation range is large (> 300), likely in feet
  // This heuristic works for typical terrain data:
  // - 100m elevation change = 328 feet (would trigger feet)
  // - Most small sites < 100m change would stay in meters
  return range > 300 ? 'feet' : 'meters';
}

/**
 * Convert elevation from feet to meters
 * 1 foot = 0.3048 meters
 * @param elevation - Elevation value in feet
 * @returns Elevation in meters
 */
export function convertFeetToMeters(elevation: number): number {
  return elevation * 0.3048;
}

/**
 * Convert all elevations to meters if they are in feet
 * @param elevations - Array of elevation values
 * @param unit - Unit of the elevation values
 * @returns Array of elevations in meters
 */
export function normalizeElevations(
  elevations: number[],
  unit: 'feet' | 'meters'
): number[] {
  if (unit === 'meters') return elevations;
  return elevations.map(convertFeetToMeters);
}

/**
 * Validate that elevation value is numeric and within reasonable global range
 * Global elevation range: Dead Sea (-430m) to Mt. Everest (8849m)
 * Using wider range for safety: -500m to 9000m
 * @param elevation - Elevation value to validate
 * @returns true if valid
 */
export function isValidElevation(elevation: number): boolean {
  return (
    typeof elevation === 'number' &&
    !isNaN(elevation) &&
    isFinite(elevation) &&
    elevation >= -500 &&
    elevation <= 9000
  );
}

/**
 * Find elevation field name from properties object
 * Tries common field names used in terrain data
 * @param properties - Properties object from geospatial feature
 * @returns Field name containing elevation, or null if not found
 */
export function findElevationField(properties: Record<string, any>): string | null {
  const elevationFieldNames = [
    'elevation',
    'ELEVATION',
    'elev',
    'ELEV',
    'z',
    'Z',
    'height',
    'HEIGHT',
    'level',
    'LEVEL',
    'contour',
    'CONTOUR',
  ];

  for (const fieldName of elevationFieldNames) {
    if (fieldName in properties) {
      const value = properties[fieldName];
      if (typeof value === 'number' && !isNaN(value)) {
        return fieldName;
      }
    }
  }

  return null;
}
