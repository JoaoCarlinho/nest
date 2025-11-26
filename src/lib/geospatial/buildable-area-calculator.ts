/**
 * Story 1.5: Buildable Area Calculation
 *
 * Calculates buildable area by subtracting exclusion zones (with buffers) from property boundary.
 * Handles multiple disconnected buildable regions (MultiPolygon result).
 */

import * as turf from '@turf/turf';
import type { Polygon, MultiPolygon, Feature } from 'geojson';
import { prisma } from '@/lib/prisma';

export interface BuildableAreaResult {
  /** Buildable area geometry (may be MultiPolygon if disconnected regions) */
  geometry: Polygon | MultiPolygon;
  /** Buildable area in square meters */
  areaSquareMeters: number;
  /** Buildable area in acres */
  areaAcres: number;
  /** Buildable area in hectares */
  areaHectares: number;
  /** Total property area in square meters */
  totalPropertyArea: number;
  /** Excluded area in square meters */
  excludedArea: number;
  /** Buildable percentage (0-100) */
  buildablePercent: number;
  /** Number of exclusion zones applied */
  exclusionCount: number;
}

export interface ExclusionZoneInput {
  geometry: Polygon;
  bufferedGeometry?: Polygon | null;
}

/**
 * Calculates buildable area by subtracting exclusion zones from property boundary.
 *
 * Algorithm:
 * 1. Start with property boundary polygon
 * 2. Union all exclusion zones (use buffered geometry if available)
 * 3. Subtract exclusion union from property boundary
 * 4. Calculate area statistics
 *
 * @param boundaryGeometry - Property boundary polygon (WGS84)
 * @param exclusionZones - Array of exclusion zone geometries
 * @returns Buildable area result with geometry and statistics
 *
 * @example
 * ```typescript
 * const result = calculateBuildableArea(
 *   propertyBoundary.geometry,
 *   exclusionZones.map(z => ({
 *     geometry: z.geometry,
 *     bufferedGeometry: z.bufferedGeometry
 *   }))
 * );
 *
 * console.log(`Buildable: ${result.buildablePercent.toFixed(1)}%`);
 * ```
 */
export function calculateBuildableArea(
  boundaryGeometry: Polygon,
  exclusionZones: ExclusionZoneInput[]
): BuildableAreaResult {
  try {
    // 1. Create property boundary polygon
    const boundaryPolygon = turf.polygon(boundaryGeometry.coordinates);
    const totalArea = turf.area(boundaryPolygon);

    // 2. If no exclusion zones, entire property is buildable
    if (exclusionZones.length === 0) {
      return {
        geometry: boundaryGeometry,
        areaSquareMeters: totalArea,
        areaAcres: totalArea / 4046.86,
        areaHectares: totalArea / 10000,
        totalPropertyArea: totalArea,
        excludedArea: 0,
        buildablePercent: 100,
        exclusionCount: 0,
      };
    }

    // 3. Union all exclusion zones (use buffered geometry if available)
    const zonePolygons = exclusionZones.map((zone) => {
      const zoneGeometry = zone.bufferedGeometry || zone.geometry;
      return turf.polygon(zoneGeometry.coordinates);
    });

    // Create FeatureCollection and dissolve (union) all zones
    const exclusionCollection = turf.featureCollection(zonePolygons);
    let exclusionUnion: Feature<Polygon | MultiPolygon> | null = null;

    if (zonePolygons.length === 1) {
      exclusionUnion = zonePolygons[0];
    } else if (zonePolygons.length > 1) {
      // Union zones pairwise
      exclusionUnion = zonePolygons[0];
      for (let i = 1; i < zonePolygons.length; i++) {
        const unionResult = turf.union(
          exclusionUnion as Feature<Polygon | MultiPolygon>,
          zonePolygons[i]
        );
        if (unionResult) {
          exclusionUnion = unionResult;
        }
      }
    }

    // 4. Subtract exclusions from property boundary
    let buildableGeometry: Feature<Polygon | MultiPolygon> | null =
      boundaryPolygon;

    if (exclusionUnion) {
      const differenceResult = turf.difference(boundaryPolygon, exclusionUnion);
      if (differenceResult) {
        buildableGeometry = differenceResult;
      } else {
        // Edge case: exclusions cover entire property
        return {
          geometry: {
            type: 'MultiPolygon',
            coordinates: [],
          },
          areaSquareMeters: 0,
          areaAcres: 0,
          areaHectares: 0,
          totalPropertyArea: totalArea,
          excludedArea: totalArea,
          buildablePercent: 0,
          exclusionCount: exclusionZones.length,
        };
      }
    }

    // 5. Calculate buildable area statistics
    const buildableArea = turf.area(buildableGeometry);
    const excludedArea = totalArea - buildableArea;
    const buildablePercent = (buildableArea / totalArea) * 100;

    return {
      geometry: buildableGeometry.geometry,
      areaSquareMeters: buildableArea,
      areaAcres: buildableArea / 4046.86,
      areaHectares: buildableArea / 10000,
      totalPropertyArea: totalArea,
      excludedArea,
      buildablePercent,
      exclusionCount: exclusionZones.length,
    };
  } catch (error) {
    throw new Error(
      `Buildable area calculation failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

/**
 * Calculates and persists buildable area for a project in the database.
 *
 * @param projectId - Project ID
 * @returns Buildable area result
 * @throws Error if property boundary not found
 */
export async function calculateAndSaveBuildableArea(
  projectId: string
): Promise<BuildableAreaResult> {
  // 1. Get property boundary
  const boundary = await prisma.propertyBoundary.findFirst({
    where: { projectId },
  });

  if (!boundary) {
    throw new Error(
      'Property boundary required before calculating buildable area. Please upload property boundary KML first (Story 1.2).'
    );
  }

  // 2. Get all exclusion zones with buffered geometries
  const exclusionZones = await prisma.exclusionZone.findMany({
    where: { projectId },
  });

  // 3. Calculate buildable area
  const result = calculateBuildableArea(
    boundary.geometry as unknown as Polygon,
    exclusionZones.map((zone) => ({
      geometry: zone.geometry as unknown as Polygon,
      bufferedGeometry: zone.bufferedGeometry as unknown as Polygon | null,
    }))
  );

  // 4. Upsert buildable area in database
  await prisma.buildableArea.upsert({
    where: { projectId },
    create: {
      projectId,
      propertyBoundaryId: boundary.id,
      geometry: result.geometry as any, // Prisma Unsupported type
      areaSquareMeters: result.areaSquareMeters,
      areaAcres: result.areaAcres,
      areaHectares: result.areaHectares,
      totalPropertyArea: result.totalPropertyArea,
      excludedArea: result.excludedArea,
      buildablePercent: result.buildablePercent,
      exclusionCount: result.exclusionCount,
    },
    update: {
      geometry: result.geometry as any,
      areaSquareMeters: result.areaSquareMeters,
      areaAcres: result.areaAcres,
      areaHectares: result.areaHectares,
      excludedArea: result.excludedArea,
      buildablePercent: result.buildablePercent,
      exclusionCount: result.exclusionCount,
      calculatedAt: new Date(),
    },
  });

  return result;
}

/**
 * Converts area from square meters to acres.
 *
 * @param squareMeters - Area in square meters
 * @returns Area in acres
 */
export function squareMetersToAcres(squareMeters: number): number {
  return squareMeters / 4046.86;
}

/**
 * Converts area from square meters to hectares.
 *
 * @param squareMeters - Area in square meters
 * @returns Area in hectares
 */
export function squareMetersToHectares(squareMeters: number): number {
  return squareMeters / 10000;
}

/**
 * Checks if buildable area meets minimum threshold for development.
 *
 * @param buildablePercent - Buildable percentage (0-100)
 * @param threshold - Minimum buildable percentage (default: 5%)
 * @returns True if buildable area meets threshold
 */
export function meetsBuildableThreshold(
  buildablePercent: number,
  threshold: number = 5.0
): boolean {
  return buildablePercent >= threshold;
}

/**
 * Gets buildable area statistics summary for display.
 *
 * @param result - Buildable area result
 * @returns Formatted statistics object
 */
export function getBuildableAreaSummary(result: BuildableAreaResult): {
  totalArea: string;
  excludedArea: string;
  buildableArea: string;
  buildablePercent: string;
  exclusionCount: number;
} {
  return {
    totalArea: `${result.areaAcres.toFixed(2)} acres (${result.totalPropertyArea.toFixed(
      0
    )} m²)`,
    excludedArea: `${squareMetersToAcres(result.excludedArea).toFixed(
      2
    )} acres (${result.excludedArea.toFixed(0)} m²)`,
    buildableArea: `${result.areaAcres.toFixed(2)} acres (${result.areaSquareMeters.toFixed(
      0
    )} m²)`,
    buildablePercent: `${result.buildablePercent.toFixed(1)}%`,
    exclusionCount: result.exclusionCount,
  };
}
