/**
 * Story 1.5: Exclusion Zone Buffer Expansion
 *
 * Applies configurable buffer distances to exclusion zones based on type.
 * Buffers expand zones for regulatory compliance (e.g., 50ft wetland buffer).
 */

import * as turf from '@turf/turf';
import type { Polygon } from 'geojson';
import { ExclusionZoneType } from '@prisma/client';

/**
 * Default buffer distances by exclusion zone type (in meters).
 *
 * Based on common US regulatory requirements:
 * - Wetlands: 50m typical state/federal buffer
 * - Protected Areas: 100m for endangered species habitat
 * - Easements: 5m for utility access corridors
 * - Buffer/Setback/Custom: User-specified, no default
 */
export const DEFAULT_BUFFER_DISTANCES: Record<ExclusionZoneType, number> = {
  WETLAND: 50.0, // 50 meters (~164 feet)
  PROTECTED_AREA: 100.0, // 100 meters (~328 feet)
  EASEMENT: 5.0, // 5 meters (~16 feet)
  BUFFER: 0, // User-specified
  SETBACK: 0, // User-specified
  CUSTOM: 0, // No default buffer
};

export interface BufferOptions {
  /** Buffer distance in meters (overrides default) */
  distance?: number;
  /** Number of steps for buffer calculation (higher = smoother curves) */
  steps?: number;
  /** Simplify buffered geometry (reduces vertex count) */
  simplify?: boolean;
  /** Simplification tolerance in meters */
  tolerance?: number;
}

/**
 * Applies a buffer (expansion) to an exclusion zone polygon.
 *
 * @param geometry - The exclusion zone polygon (WGS84)
 * @param zoneType - The type of exclusion zone
 * @param options - Buffer options
 * @returns Buffered polygon geometry, or original geometry if buffer distance is 0
 *
 * @example
 * ```typescript
 * // Apply default 50m buffer to wetland
 * const buffered = applyZoneBuffer(
 *   wetlandPolygon.coordinates,
 *   'WETLAND'
 * );
 *
 * // Apply custom 30m buffer with simplification
 * const buffered = applyZoneBuffer(
 *   zone.geometry,
 *   'CUSTOM',
 *   { distance: 30, simplify: true, tolerance: 1.0 }
 * );
 * ```
 */
export function applyZoneBuffer(
  geometry: Polygon,
  zoneType: ExclusionZoneType,
  options: BufferOptions = {}
): Polygon {
  const {
    distance = DEFAULT_BUFFER_DISTANCES[zoneType],
    steps = 8,
    simplify = false,
    tolerance = 1.0,
  } = options;

  // If buffer distance is 0 or negative, return original geometry
  if (distance <= 0) {
    return geometry;
  }

  try {
    const polygon = turf.polygon(geometry.coordinates);

    // Apply buffer using Turf.js
    // Convert meters to appropriate units based on coordinate system (WGS84)
    const buffered = turf.buffer(polygon, distance, {
      units: 'meters',
      steps,
    });

    if (!buffered) {
      throw new Error('Buffer operation returned null');
    }

    // Simplify geometry if requested (reduces vertex count)
    let bufferedGeometry = buffered.geometry as Polygon;

    if (simplify) {
      const simplified = turf.simplify(buffered, {
        tolerance: tolerance / 111320, // Convert meters to degrees (approximate)
        highQuality: true,
      });
      bufferedGeometry = simplified.geometry as Polygon;
    }

    return bufferedGeometry;
  } catch (error) {
    console.error('Buffer application failed:', error);
    // Fallback: return original geometry
    return geometry;
  }
}

/**
 * Gets the default buffer distance for a given zone type.
 *
 * @param zoneType - The exclusion zone type
 * @returns Default buffer distance in meters
 */
export function getDefaultBufferDistance(
  zoneType: ExclusionZoneType
): number {
  return DEFAULT_BUFFER_DISTANCES[zoneType];
}

/**
 * Calculates the total area added by applying a buffer.
 *
 * @param originalGeometry - Original zone polygon
 * @param bufferedGeometry - Buffered zone polygon
 * @returns Buffer area in square meters
 */
export function calculateBufferArea(
  originalGeometry: Polygon,
  bufferedGeometry: Polygon
): number {
  try {
    const original = turf.polygon(originalGeometry.coordinates);
    const buffered = turf.polygon(bufferedGeometry.coordinates);

    const originalArea = turf.area(original);
    const bufferedArea = turf.area(buffered);

    return bufferedArea - originalArea;
  } catch {
    return 0;
  }
}

/**
 * Determines if a buffer should be applied based on zone type and attributes.
 *
 * @param zoneType - The exclusion zone type
 * @param attributes - Zone-specific attributes (may specify custom buffer requirements)
 * @returns True if buffer should be applied
 */
export function shouldApplyBuffer(
  zoneType: ExclusionZoneType,
  attributes?: Record<string, unknown>
): boolean {
  // WETLAND and PROTECTED_AREA always get buffers by default
  if (zoneType === 'WETLAND' || zoneType === 'PROTECTED_AREA') {
    return true;
  }

  // EASEMENT gets buffer if it's a utility corridor
  if (zoneType === 'EASEMENT' && attributes?.utilityType) {
    return true;
  }

  // BUFFER and SETBACK are explicitly buffer zones
  if (zoneType === 'BUFFER' || zoneType === 'SETBACK') {
    return true;
  }

  // CUSTOM zones only get buffer if explicitly specified
  if (zoneType === 'CUSTOM' && attributes?.bufferRequired === true) {
    return true;
  }

  return false;
}

/**
 * Validates that a buffer distance is within acceptable limits.
 * Prevents excessively large buffers that might cover entire property.
 *
 * @param bufferDistance - Buffer distance in meters
 * @param maxAllowedBuffer - Maximum allowed buffer in meters (default: 500m)
 * @returns Validation result
 */
export function validateBufferDistance(
  bufferDistance: number,
  maxAllowedBuffer: number = 500
): { valid: boolean; error?: string } {
  if (bufferDistance < 0) {
    return {
      valid: false,
      error: 'Buffer distance must be non-negative',
    };
  }

  if (bufferDistance > maxAllowedBuffer) {
    return {
      valid: false,
      error: `Buffer distance (${bufferDistance}m) exceeds maximum allowed (${maxAllowedBuffer}m)`,
    };
  }

  return { valid: true };
}

/**
 * Converts buffer distance from feet to meters.
 * Useful for US regulatory requirements specified in feet.
 *
 * @param feet - Distance in feet
 * @returns Distance in meters
 */
export function feetToMeters(feet: number): number {
  return feet * 0.3048;
}

/**
 * Converts buffer distance from meters to feet.
 *
 * @param meters - Distance in meters
 * @returns Distance in feet
 */
export function metersToFeet(meters: number): number {
  return meters / 0.3048;
}
