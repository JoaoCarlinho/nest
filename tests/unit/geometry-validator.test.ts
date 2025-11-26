import { describe, it, expect } from 'vitest';
import { GeometryValidator } from '@/lib/geospatial/geometry-validator';
import { GeospatialError } from '@/lib/errors/GeospatialError';
import { KMLBoundaryParser } from '@/lib/geospatial/kml-boundary-parser';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Polygon } from 'geojson';

describe('GeometryValidator', () => {
  const validator = new GeometryValidator();
  const parser = new KMLBoundaryParser();
  const fixturesPath = join(__dirname, '../fixtures/boundaries');

  describe('Polygon validation', () => {
    it('should validate a valid simple polygon', () => {
      const kml = readFileSync(join(fixturesPath, 'valid-simple-boundary.kml'), 'utf-8');
      const geometry = parser.parse(kml);

      expect(() => validator.validatePolygon(geometry)).not.toThrow();
    });

    it('should validate a valid complex polygon', () => {
      const kml = readFileSync(join(fixturesPath, 'valid-complex-boundary.kml'), 'utf-8');
      const geometry = parser.parse(kml);

      expect(() => validator.validatePolygon(geometry)).not.toThrow();
    });

    it('should validate polygon with holes', () => {
      const kml = readFileSync(join(fixturesPath, 'valid-multi-polygon-boundary.kml'), 'utf-8');
      const geometry = parser.parse(kml);

      expect(() => validator.validatePolygon(geometry)).not.toThrow();
    });

    it('should reject self-intersecting polygon', () => {
      const kml = readFileSync(join(fixturesPath, 'invalid-self-intersecting.kml'), 'utf-8');
      const geometry = parser.parse(kml);

      try {
        validator.validatePolygon(geometry);
        expect.fail('Should have thrown GeospatialError');
      } catch (error) {
        expect(error).toBeInstanceOf(GeospatialError);
        const geospatialError = error as GeospatialError;
        expect(geospatialError.details?.validationErrors).toBeDefined();
        const hasIntersectionError = geospatialError.details?.validationErrors.some((e: string) =>
          e.includes('self-intersecting')
        );
        expect(hasIntersectionError).toBe(true);
      }
    });

    it('should reject unclosed polygon', () => {
      const kml = readFileSync(join(fixturesPath, 'invalid-unclosed-polygon.kml'), 'utf-8');
      const geometry = parser.parse(kml);

      try {
        validator.validatePolygon(geometry);
        expect.fail('Should have thrown GeospatialError');
      } catch (error) {
        expect(error).toBeInstanceOf(GeospatialError);
        const geospatialError = error as GeospatialError;
        expect(geospatialError.details?.validationErrors).toBeDefined();
        const hasClosedError = geospatialError.details?.validationErrors.some((e: string) =>
          e.includes('not closed')
        );
        expect(hasClosedError).toBe(true);
      }
    });

    it('should reject polygon with too few vertices', () => {
      const invalidPolygon: Polygon = {
        type: 'Polygon',
        coordinates: [[
          [-122.0, 37.0, 0],
          [-121.0, 37.0, 0],
          [-122.0, 37.0, 0], // Only 3 points including closing
        ]],
      };

      try {
        validator.validatePolygon(invalidPolygon);
        expect.fail('Should have thrown GeospatialError');
      } catch (error) {
        expect(error).toBeInstanceOf(GeospatialError);
        const geospatialError = error as GeospatialError;
        expect(geospatialError.details?.validationErrors).toBeDefined();
        const hasVerticesError = geospatialError.details?.validationErrors.some((e: string) =>
          e.includes('at least 3 unique points')
        );
        expect(hasVerticesError).toBe(true);
      }
    });
  });

  describe('Closed polygon check', () => {
    it('should return true for closed polygon', () => {
      const polygon: Polygon = {
        type: 'Polygon',
        coordinates: [[
          [-122.0, 37.0, 0],
          [-121.0, 37.0, 0],
          [-121.0, 38.0, 0],
          [-122.0, 38.0, 0],
          [-122.0, 37.0, 0],
        ]],
      };

      expect(validator.isClosed(polygon)).toBe(true);
    });

    it('should return false for unclosed polygon', () => {
      const polygon: Polygon = {
        type: 'Polygon',
        coordinates: [[
          [-122.0, 37.0, 0],
          [-121.0, 37.0, 0],
          [-121.0, 38.0, 0],
          [-122.0, 38.0, 0],
        ]],
      };

      expect(validator.isClosed(polygon)).toBe(false);
    });
  });

  describe('Self-intersection detection', () => {
    it('should detect self-intersecting polygon (bowtie)', () => {
      const kml = readFileSync(join(fixturesPath, 'invalid-self-intersecting.kml'), 'utf-8');
      const geometry = parser.parse(kml);

      const result = validator.hasSelfIntersections(geometry);

      expect(result.hasSelfIntersections).toBe(true);
      expect(result.intersectionPoints).toBeDefined();
      expect(result.intersectionPoints!.length).toBeGreaterThan(0);
    });

    it('should not detect intersections in valid polygon', () => {
      const kml = readFileSync(join(fixturesPath, 'valid-simple-boundary.kml'), 'utf-8');
      const geometry = parser.parse(kml);

      const result = validator.hasSelfIntersections(geometry);

      expect(result.hasSelfIntersections).toBe(false);
      expect(result.intersectionPoints).toBeUndefined();
    });
  });

  describe('Minimum vertices check', () => {
    it('should return true for polygon with 4+ points', () => {
      const polygon: Polygon = {
        type: 'Polygon',
        coordinates: [[
          [-122.0, 37.0, 0],
          [-121.0, 37.0, 0],
          [-121.0, 38.0, 0],
          [-122.0, 38.0, 0],
          [-122.0, 37.0, 0],
        ]],
      };

      expect(validator.hasMinimumVertices(polygon)).toBe(true);
    });

    it('should return false for polygon with < 4 points', () => {
      const polygon: Polygon = {
        type: 'Polygon',
        coordinates: [[
          [-122.0, 37.0, 0],
          [-121.0, 37.0, 0],
          [-122.0, 37.0, 0],
        ]],
      };

      expect(validator.hasMinimumVertices(polygon)).toBe(false);
    });
  });

  describe('Area calculations', () => {
    it('should calculate area for rectangular polygon', () => {
      // Create a ~0.8km x 1km square (approximately)
      const polygon: Polygon = {
        type: 'Polygon',
        coordinates: [[
          [-122.0, 37.0, 0],
          [-122.0, 37.009, 0], // ~1km north
          [-121.991, 37.009, 0], // ~1km east
          [-121.991, 37.0, 0],
          [-122.0, 37.0, 0],
        ]],
      };

      const area = validator.calculateArea(polygon);

      // Should be close to 800,000 m² (actual calculated area)
      expect(area).toBeGreaterThan(700000);
      expect(area).toBeLessThan(900000);
    });

    it('should convert area to acres correctly', () => {
      // 1 acre = 4046.86 m²
      const squareMeters = 4046.86;

      const acres = validator.convertToAcres(squareMeters);

      expect(acres).toBeCloseTo(1.0, 1);
    });

    it('should convert area to hectares correctly', () => {
      // 1 hectare = 10,000 m²
      const squareMeters = 10000;

      const hectares = validator.convertToHectares(squareMeters);

      expect(hectares).toBeCloseTo(1.0, 1);
    });
  });

  describe('Perimeter calculations', () => {
    it('should calculate perimeter for rectangular polygon', () => {
      const kml = readFileSync(join(fixturesPath, 'valid-simple-boundary.kml'), 'utf-8');
      const geometry = parser.parse(kml);

      const perimeter = validator.calculatePerimeter(geometry);

      expect(perimeter).toBeGreaterThan(0);
    });
  });

  describe('Centroid calculations', () => {
    it('should calculate centroid for rectangular polygon', () => {
      const polygon: Polygon = {
        type: 'Polygon',
        coordinates: [[
          [-122.0, 37.0, 0],
          [-121.0, 37.0, 0],
          [-121.0, 38.0, 0],
          [-122.0, 38.0, 0],
          [-122.0, 37.0, 0],
        ]],
      };

      const centroid = validator.calculateCentroid(polygon);

      expect(centroid.lng).toBeCloseTo(-121.5, 1);
      expect(centroid.lat).toBeCloseTo(37.5, 1);
    });

    it('should calculate centroid for complex polygon', () => {
      const kml = readFileSync(join(fixturesPath, 'valid-complex-boundary.kml'), 'utf-8');
      const geometry = parser.parse(kml);

      const centroid = validator.calculateCentroid(geometry);

      expect(centroid.lat).toBeGreaterThan(0);
      expect(centroid.lng).toBeLessThan(0);
    });
  });
});
