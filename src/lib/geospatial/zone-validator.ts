/**
 * Story 1.5: Exclusion Zone Validation
 *
 * Validates that exclusion zones are fully contained within property boundaries.
 * Provides tolerance for GPS inaccuracies and detailed error messages.
 */

import * as turf from '@turf/turf';
import type { Polygon } from 'geojson';

export interface ZoneValidationResult {
  valid: boolean;
  error?: string;
  outsidePercent?: number;
  outsideAreaSquareMeters?: number;
}

export interface ZoneValidationOptions {
  /** GPS tolerance in meters (default: 1.0m) */
  tolerance?: number;
  /** Allow zones slightly outside boundary within tolerance */
  allowOutsideTolerance?: boolean;
}

/**
 * Validates that an exclusion zone polygon is fully contained within a property boundary.
 *
 * @param zoneGeometry - The exclusion zone polygon (WGS84)
 * @param boundaryGeometry - The property boundary polygon (WGS84)
 * @param options - Validation options
 * @returns Validation result with detailed error information
 *
 * @example
 * ```typescript
 * const result = validateZoneWithinBoundary(
 *   zonePolygon.coordinates,
 *   propertyBoundary.coordinates,
 *   { tolerance: 1.0 }
 * );
 *
 * if (!result.valid) {
 *   console.error(`Zone extends ${result.outsidePercent}% outside boundary`);
 * }
 * ```
 */
export function validateZoneWithinBoundary(
  zoneGeometry: Polygon,
  boundaryGeometry: Polygon,
  options: ZoneValidationOptions = {}
): ZoneValidationResult {
  const {
    tolerance = 1.0, // 1 meter default GPS tolerance
    allowOutsideTolerance = false,
  } = options;

  try {
    // Create Turf polygons
    const zonePolygon = turf.polygon(zoneGeometry.coordinates);
    const boundaryPolygon = turf.polygon(boundaryGeometry.coordinates);

    // Validate polygon geometries
    if (!turf.booleanValid(zonePolygon)) {
      return {
        valid: false,
        error: 'Exclusion zone geometry is invalid (self-intersecting or unclosed)',
      };
    }

    if (!turf.booleanValid(boundaryPolygon)) {
      return {
        valid: false,
        error: 'Property boundary geometry is invalid',
      };
    }

    // Apply small buffer to boundary for GPS tolerance
    const bufferedBoundary = turf.buffer(boundaryPolygon, tolerance, {
      units: 'meters',
    });

    if (!bufferedBoundary) {
      return {
        valid: false,
        error: 'Failed to apply tolerance buffer to property boundary',
      };
    }

    // Check if zone is fully contained within boundary (with tolerance)
    const isContained = turf.booleanContains(bufferedBoundary, zonePolygon);

    if (isContained) {
      return { valid: true };
    }

    // Zone extends outside boundary - calculate how much
    const outsideGeometry = turf.difference(zonePolygon, bufferedBoundary);

    if (!outsideGeometry) {
      // Edge case: zone is completely outside boundary
      return {
        valid: false,
        error: 'Exclusion zone is completely outside property boundary',
        outsidePercent: 100,
      };
    }

    const zoneArea = turf.area(zonePolygon);
    const outsideArea = turf.area(outsideGeometry);
    const outsidePercent = (outsideArea / zoneArea) * 100;

    // If zone only slightly extends outside and tolerance is allowed, pass validation
    if (allowOutsideTolerance && outsidePercent < 1.0) {
      return { valid: true };
    }

    return {
      valid: false,
      error: `Exclusion zone extends ${outsidePercent.toFixed(
        1
      )}% outside property boundary`,
      outsidePercent: parseFloat(outsidePercent.toFixed(1)),
      outsideAreaSquareMeters: parseFloat(outsideArea.toFixed(2)),
    };
  } catch (error) {
    return {
      valid: false,
      error: `Zone validation error: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    };
  }
}

/**
 * Validates that a polygon geometry is valid (no self-intersections, properly closed).
 *
 * @param geometry - Polygon geometry to validate
 * @returns True if valid, false otherwise
 */
export function isValidPolygonGeometry(geometry: Polygon): boolean {
  try {
    const polygon = turf.polygon(geometry.coordinates);
    return turf.booleanValid(polygon);
  } catch {
    return false;
  }
}

/**
 * Validates that exclusion zones do not create a buildable area below the warning threshold.
 *
 * @param totalAreaSquareMeters - Total property area in square meters
 * @param excludedAreaSquareMeters - Total excluded area in square meters
 * @param warningThreshold - Warning threshold percentage (default: 5%)
 * @returns Validation result
 */
export function validateBuildableAreaThreshold(
  totalAreaSquareMeters: number,
  excludedAreaSquareMeters: number,
  warningThreshold: number = 5.0
): ZoneValidationResult {
  const buildableArea = totalAreaSquareMeters - excludedAreaSquareMeters;
  const buildablePercent = (buildableArea / totalAreaSquareMeters) * 100;

  if (buildablePercent < warningThreshold) {
    return {
      valid: false,
      error: `Buildable area (${buildablePercent.toFixed(
        1
      )}%) is below warning threshold (${warningThreshold}%)`,
    };
  }

  return { valid: true };
}

/**
 * Calculates the area of overlap between two polygons.
 * Useful for detecting overlapping exclusion zones.
 *
 * @param polygon1 - First polygon
 * @param polygon2 - Second polygon
 * @returns Overlap area in square meters, or 0 if no overlap
 */
export function calculateOverlapArea(
  polygon1: Polygon,
  polygon2: Polygon
): number {
  try {
    const poly1 = turf.polygon(polygon1.coordinates);
    const poly2 = turf.polygon(polygon2.coordinates);

    const intersection = turf.intersect(poly1, poly2);

    if (!intersection) {
      return 0;
    }

    return turf.area(intersection);
  } catch {
    return 0;
  }
}
