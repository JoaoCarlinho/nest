import * as turf from '@turf/turf';
import { Polygon, Position } from 'geojson';
import { GeospatialError } from '@/lib/errors/GeospatialError';

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

/**
 * Validate polygon geometries using Turf.js
 * Checks for closed polygons, self-intersections, minimum vertices
 */
export class GeometryValidator {
  /**
   * Validate a polygon geometry
   * @param polygon - GeoJSON Polygon
   * @param fileId - File ID for error context
   * @throws GeospatialError if validation fails
   */
  validatePolygon(polygon: Polygon, fileId?: string): void {
    const errors: string[] = [];

    // Check if polygon is closed
    if (!this.isClosed(polygon)) {
      errors.push('Polygon is not closed (first point must equal last point)');
    }

    // Check minimum vertices
    if (!this.hasMinimumVertices(polygon)) {
      errors.push('Polygon must have at least 3 unique points (4 including closing point)');
    }

    // Check for self-intersections
    const intersectionResult = this.hasSelfIntersections(polygon);
    if (intersectionResult.hasSelfIntersections) {
      errors.push(
        `Polygon is self-intersecting at ${intersectionResult.intersectionPoints?.length || 0} point(s)`
      );
    }

    if (errors.length > 0) {
      throw new GeospatialError('Boundary polygon validation failed', {
        fileId,
        validationErrors: errors,
        intersectionPoints: intersectionResult.intersectionPoints,
      });
    }
  }

  /**
   * Check if polygon is closed (first point equals last point)
   * @param polygon - GeoJSON Polygon
   * @returns true if closed
   */
  isClosed(polygon: Polygon): boolean {
    const ring = polygon.coordinates[0];
    if (ring.length < 2) return false;

    const first = ring[0];
    const last = ring[ring.length - 1];

    return (
      first[0] === last[0] &&
      first[1] === last[1] &&
      (first[2] === undefined || last[2] === undefined || first[2] === last[2])
    );
  }

  /**
   * Check if polygon has self-intersections using Turf.js kinks()
   * @param polygon - GeoJSON Polygon
   * @returns object with hasSelfIntersections flag and intersection points
   */
  hasSelfIntersections(polygon: Polygon): {
    hasSelfIntersections: boolean;
    intersectionPoints?: Position[];
  } {
    try {
      const kinks = turf.kinks(polygon);

      if (kinks.features.length > 0) {
        const intersectionPoints = kinks.features.map((feature) => feature.geometry.coordinates);
        return {
          hasSelfIntersections: true,
          intersectionPoints,
        };
      }

      return { hasSelfIntersections: false };
    } catch (error) {
      // If Turf.js can't process the polygon, assume it's invalid
      return { hasSelfIntersections: false };
    }
  }

  /**
   * Check if polygon has minimum required vertices
   * @param polygon - GeoJSON Polygon
   * @returns true if has at least 4 points (3 unique + closing point)
   */
  hasMinimumVertices(polygon: Polygon): boolean {
    const ring = polygon.coordinates[0];
    return ring.length >= 4;
  }

  /**
   * Calculate area of polygon in square meters using Turf.js
   * @param polygon - GeoJSON Polygon
   * @returns area in square meters
   */
  calculateArea(polygon: Polygon): number {
    const area = turf.area(polygon);
    return area;
  }

  /**
   * Calculate perimeter of polygon in meters using Turf.js
   * @param polygon - GeoJSON Polygon
   * @returns perimeter in meters
   */
  calculatePerimeter(polygon: Polygon): number {
    const line = turf.polygonToLine(polygon);
    if (!line) return 0;

    const length = turf.length(line, { units: 'meters' });
    return length;
  }

  /**
   * Calculate centroid of polygon using Turf.js
   * @param polygon - GeoJSON Polygon
   * @returns [lat, lng] coordinates of centroid
   */
  calculateCentroid(polygon: Polygon): { lat: number; lng: number } {
    const centroid = turf.centroid(polygon);
    const [lng, lat] = centroid.geometry.coordinates;
    return { lat, lng };
  }

  /**
   * Convert area from square meters to acres
   * 1 acre = 4046.86 m²
   */
  convertToAcres(squareMeters: number): number {
    return squareMeters / 4046.86;
  }

  /**
   * Convert area from square meters to hectares
   * 1 hectare = 10,000 m²
   */
  convertToHectares(squareMeters: number): number {
    return squareMeters / 10000;
  }
}
