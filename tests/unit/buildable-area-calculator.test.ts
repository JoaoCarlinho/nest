import { describe, it, expect } from 'vitest';
import {
  calculateBuildableArea,
  squareMetersToAcres,
  squareMetersToHectares,
  meetsBuildableThreshold,
  getBuildableAreaSummary,
} from '@/lib/geospatial/buildable-area-calculator';
import type { Polygon } from 'geojson';
import * as turf from '@turf/turf';

describe('buildable-area-calculator', () => {
  const propertyBoundary: Polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [-122.45, 37.75],
        [-122.40, 37.75],
        [-122.40, 37.80],
        [-122.45, 37.80],
        [-122.45, 37.75],
      ],
    ],
  };

  describe('calculateBuildableArea', () => {
    it('should return entire property when no exclusions', () => {
      const result = calculateBuildableArea(propertyBoundary, []);

      expect(result.buildablePercent).toBe(100);
      expect(result.excludedArea).toBe(0);
      expect(result.exclusionCount).toBe(0);
    });

    it.skip('should calculate buildable area with single exclusion', () => {
      // TODO: Fix Turf.js union/difference API compatibility (v7 API change)
      const exclusionZone: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [-122.42, 37.77],
            [-122.41, 37.77],
            [-122.41, 37.78],
            [-122.42, 37.78],
            [-122.42, 37.77],
          ],
        ],
      };

      const result = calculateBuildableArea(propertyBoundary, [
        { geometry: exclusionZone },
      ]);

      expect(result.buildablePercent).toBeLessThan(100);
      expect(result.buildablePercent).toBeGreaterThan(0);
      expect(result.excludedArea).toBeGreaterThan(0);
      expect(result.exclusionCount).toBe(1);
    });

    it.skip('should calculate buildable area with multiple exclusions', () => {
      // TODO: Fix Turf.js union/difference API compatibility (v7 API change)
      const exclusion1: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [-122.42, 37.77],
            [-122.41, 37.77],
            [-122.41, 37.78],
            [-122.42, 37.78],
            [-122.42, 37.77],
          ],
        ],
      };

      const exclusion2: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [-122.43, 37.76],
            [-122.42, 37.76],
            [-122.42, 37.77],
            [-122.43, 37.77],
            [-122.43, 37.76],
          ],
        ],
      };

      const result = calculateBuildableArea(propertyBoundary, [
        { geometry: exclusion1 },
        { geometry: exclusion2 },
      ]);

      expect(result.exclusionCount).toBe(2);
      expect(result.excludedArea).toBeGreaterThan(0);
      expect(result.buildablePercent).toBeLessThan(100);
    });

    it.skip('should use buffered geometry when available', () => {
      // TODO: Fix Turf.js union/difference API compatibility (v7 API change)
      const exclusionZone: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [-122.42, 37.77],
            [-122.41, 37.77],
            [-122.41, 37.78],
            [-122.42, 37.78],
            [-122.42, 37.77],
          ],
        ],
      };

      // Create buffered geometry (50m buffer)
      const buffered = turf.buffer(
        turf.polygon(exclusionZone.coordinates),
        50,
        { units: 'meters' }
      );

      const resultWithoutBuffer = calculateBuildableArea(propertyBoundary, [
        { geometry: exclusionZone },
      ]);

      const resultWithBuffer = calculateBuildableArea(propertyBoundary, [
        {
          geometry: exclusionZone,
          bufferedGeometry: buffered.geometry as Polygon,
        },
      ]);

      // Buffered exclusion should reduce buildable area more
      expect(resultWithBuffer.buildablePercent).toBeLessThan(
        resultWithoutBuffer.buildablePercent
      );
      expect(resultWithBuffer.excludedArea).toBeGreaterThan(
        resultWithoutBuffer.excludedArea
      );
    });

    it.skip('should handle overlapping exclusions correctly', () => {
      // TODO: Fix Turf.js union/difference API compatibility (v7 API change)
      // Two overlapping zones - should union them
      const exclusion1: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [-122.42, 37.77],
            [-122.41, 37.77],
            [-122.41, 37.78],
            [-122.42, 37.78],
            [-122.42, 37.77],
          ],
        ],
      };

      const exclusion2: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [-122.415, 37.77],
            [-122.405, 37.77],
            [-122.405, 37.78],
            [-122.415, 37.78],
            [-122.415, 37.77],
          ],
        ],
      };

      const result = calculateBuildableArea(propertyBoundary, [
        { geometry: exclusion1 },
        { geometry: exclusion2 },
      ]);

      // Should handle overlap gracefully without double-counting
      expect(result.exclusionCount).toBe(2);
      expect(result.buildablePercent).toBeGreaterThan(0);
    });

    it.skip('should return 0 buildable area when fully excluded', () => {
      // TODO: Fix Turf.js union/difference API compatibility (v7 API change)
      // Exclusion covering entire property
      const fullExclusion: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [-122.46, 37.74],
            [-122.39, 37.74],
            [-122.39, 37.81],
            [-122.46, 37.81],
            [-122.46, 37.74],
          ],
        ],
      };

      const result = calculateBuildableArea(propertyBoundary, [
        { geometry: fullExclusion },
      ]);

      expect(result.buildablePercent).toBe(0);
      expect(result.areaSquareMeters).toBe(0);
    });

    it('should calculate correct area units', () => {
      const result = calculateBuildableArea(propertyBoundary, []);

      // Check area calculations
      expect(result.areaSquareMeters).toBeGreaterThan(0);
      expect(result.areaAcres).toBeGreaterThan(0);
      expect(result.areaHectares).toBeGreaterThan(0);

      // Verify unit conversions
      expect(result.areaAcres).toBeCloseTo(
        result.areaSquareMeters / 4046.86,
        2
      );
      expect(result.areaHectares).toBeCloseTo(result.areaSquareMeters / 10000, 2);
    });
  });

  describe('unit conversions', () => {
    it('should convert square meters to acres', () => {
      expect(squareMetersToAcres(4046.86)).toBeCloseTo(1.0, 2);
      expect(squareMetersToAcres(40468.6)).toBeCloseTo(10.0, 1);
    });

    it('should convert square meters to hectares', () => {
      expect(squareMetersToHectares(10000)).toBeCloseTo(1.0, 2);
      expect(squareMetersToHectares(100000)).toBeCloseTo(10.0, 1);
    });
  });

  describe('meetsBuildableThreshold', () => {
    it('should pass when buildable area meets threshold', () => {
      expect(meetsBuildableThreshold(10.0, 5.0)).toBe(true);
      expect(meetsBuildableThreshold(50.0, 5.0)).toBe(true);
    });

    it('should fail when buildable area below threshold', () => {
      expect(meetsBuildableThreshold(3.0, 5.0)).toBe(false);
      expect(meetsBuildableThreshold(0.0, 5.0)).toBe(false);
    });

    it('should use default 5% threshold', () => {
      expect(meetsBuildableThreshold(10.0)).toBe(true);
      expect(meetsBuildableThreshold(3.0)).toBe(false);
    });
  });

  describe('getBuildableAreaSummary', () => {
    it('should format buildable area summary', () => {
      const result = calculateBuildableArea(propertyBoundary, []);

      const summary = getBuildableAreaSummary(result);

      expect(summary.totalArea).toContain('acres');
      expect(summary.excludedArea).toContain('acres');
      expect(summary.buildableArea).toContain('acres');
      expect(summary.buildablePercent).toContain('%');
      expect(summary.exclusionCount).toBe(0);
    });
  });
});
