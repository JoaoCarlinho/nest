import { describe, it, expect } from 'vitest';
import {
  applyZoneBuffer,
  getDefaultBufferDistance,
  calculateBufferArea,
  shouldApplyBuffer,
  validateBufferDistance,
  feetToMeters,
  metersToFeet,
} from '@/lib/geospatial/zone-buffer';
import { ExclusionZoneType } from '@prisma/client';
import type { Polygon } from 'geojson';
import * as turf from '@turf/turf';

describe('zone-buffer', () => {
  const sampleGeometry: Polygon = {
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

  describe('applyZoneBuffer', () => {
    it('should apply default 50m buffer to wetland', () => {
      const buffered = applyZoneBuffer(sampleGeometry, 'WETLAND');

      // Buffered area should be larger than original
      const originalArea = turf.area(turf.polygon(sampleGeometry.coordinates));
      const bufferedArea = turf.area(turf.polygon(buffered.coordinates));

      expect(bufferedArea).toBeGreaterThan(originalArea);
    });

    it('should apply custom buffer distance', () => {
      const buffered30m = applyZoneBuffer(sampleGeometry, 'CUSTOM', {
        distance: 30,
      });
      const buffered60m = applyZoneBuffer(sampleGeometry, 'CUSTOM', {
        distance: 60,
      });

      const area30m = turf.area(turf.polygon(buffered30m.coordinates));
      const area60m = turf.area(turf.polygon(buffered60m.coordinates));

      // 60m buffer should create larger area than 30m buffer
      expect(area60m).toBeGreaterThan(area30m);
    });

    it('should return original geometry for 0 buffer distance', () => {
      const buffered = applyZoneBuffer(sampleGeometry, 'CUSTOM', {
        distance: 0,
      });

      expect(buffered).toEqual(sampleGeometry);
    });

    it('should apply different default buffers by zone type', () => {
      const wetlandBuffer = applyZoneBuffer(sampleGeometry, 'WETLAND');
      const protectedBuffer = applyZoneBuffer(sampleGeometry, 'PROTECTED_AREA');
      const easementBuffer = applyZoneBuffer(sampleGeometry, 'EASEMENT');

      const wetlandArea = turf.area(turf.polygon(wetlandBuffer.coordinates));
      const protectedArea = turf.area(turf.polygon(protectedBuffer.coordinates));
      const easementArea = turf.area(turf.polygon(easementBuffer.coordinates));

      // Protected areas (100m) > Wetlands (50m) > Easements (5m)
      expect(protectedArea).toBeGreaterThan(wetlandArea);
      expect(wetlandArea).toBeGreaterThan(easementArea);
    });

    it('should simplify geometry when requested', () => {
      const buffered = applyZoneBuffer(sampleGeometry, 'WETLAND', {
        distance: 50,
        simplify: true,
        tolerance: 5.0,
      });

      // Should still produce valid polygon
      expect(buffered.type).toBe('Polygon');
      expect(buffered.coordinates.length).toBeGreaterThan(0);
    });
  });

  describe('getDefaultBufferDistance', () => {
    it('should return correct default distances', () => {
      expect(getDefaultBufferDistance('WETLAND')).toBe(50);
      expect(getDefaultBufferDistance('PROTECTED_AREA')).toBe(100);
      expect(getDefaultBufferDistance('EASEMENT')).toBe(5);
      expect(getDefaultBufferDistance('BUFFER')).toBe(0);
      expect(getDefaultBufferDistance('SETBACK')).toBe(0);
      expect(getDefaultBufferDistance('CUSTOM')).toBe(0);
    });
  });

  describe('calculateBufferArea', () => {
    it('should calculate additional area from buffer', () => {
      const bufferedGeometry = applyZoneBuffer(sampleGeometry, 'WETLAND', {
        distance: 50,
      });

      const bufferArea = calculateBufferArea(sampleGeometry, bufferedGeometry);

      // Buffer should add positive area
      expect(bufferArea).toBeGreaterThan(0);
    });
  });

  describe('shouldApplyBuffer', () => {
    it('should apply buffer to wetlands by default', () => {
      expect(shouldApplyBuffer('WETLAND')).toBe(true);
    });

    it('should apply buffer to protected areas by default', () => {
      expect(shouldApplyBuffer('PROTECTED_AREA')).toBe(true);
    });

    it('should apply buffer to easements with utility type', () => {
      expect(
        shouldApplyBuffer('EASEMENT', { utilityType: 'electric' })
      ).toBe(true);
    });

    it('should not apply buffer to custom zones without explicit flag', () => {
      expect(shouldApplyBuffer('CUSTOM')).toBe(false);
    });

    it('should apply buffer to custom zones when explicitly required', () => {
      expect(
        shouldApplyBuffer('CUSTOM', { bufferRequired: true })
      ).toBe(true);
    });
  });

  describe('validateBufferDistance', () => {
    it('should validate reasonable buffer distances', () => {
      const result = validateBufferDistance(50);
      expect(result.valid).toBe(true);
    });

    it('should reject negative buffer distances', () => {
      const result = validateBufferDistance(-10);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('non-negative');
    });

    it('should reject excessively large buffers', () => {
      const result = validateBufferDistance(1000, 500);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds maximum');
    });

    it('should use custom max buffer limit', () => {
      const result = validateBufferDistance(200, 150);
      expect(result.valid).toBe(false);
    });
  });

  describe('unit conversions', () => {
    it('should convert feet to meters', () => {
      expect(feetToMeters(100)).toBeCloseTo(30.48, 2);
      expect(feetToMeters(164)).toBeCloseTo(50, 0); // ~50m wetland buffer
    });

    it('should convert meters to feet', () => {
      expect(metersToFeet(50)).toBeCloseTo(164, 0);
      expect(metersToFeet(100)).toBeCloseTo(328, 0);
    });

    it('should round-trip conversions', () => {
      const meters = 50;
      const feet = metersToFeet(meters);
      const backToMeters = feetToMeters(feet);

      expect(backToMeters).toBeCloseTo(meters, 2);
    });
  });
});
