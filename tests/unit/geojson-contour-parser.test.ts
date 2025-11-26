import { describe, it, expect } from 'vitest';
import { GeoJSONContourParser } from '@/lib/terrain/geojson-contour-parser';
import { TerrainAnalysisError } from '@/lib/errors/TerrainAnalysisError';

describe('GeoJSONContourParser', () => {
  const parser = new GeoJSONContourParser();

  describe('Valid GeoJSON parsing', () => {
    it('should parse simple GeoJSON FeatureCollection with contours', () => {
      const geojson = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [-122.4194, 37.7749, 0],
                [-122.4184, 37.7749, 0],
                [-122.4184, 37.7759, 0],
              ],
            },
            properties: {
              elevation: 100,
            },
          },
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [-122.4200, 37.7740, 0],
                [-122.4190, 37.7740, 0],
              ],
            },
            properties: {
              elev: 110,
            },
          },
        ],
      };

      const contours = parser.parse(geojson);

      expect(contours).toHaveLength(2);
      expect(contours[0].elevation).toBe(100);
      expect(contours[1].elevation).toBe(110);
      expect(contours[0].geometry.type).toBe('LineString');
      expect(contours[0].geometry.coordinates).toHaveLength(3);
    });

    it('should parse single Feature (not FeatureCollection)', () => {
      const geojson = {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-122.0, 37.0, 0],
            [-121.9, 37.0, 0],
          ],
        },
        properties: {
          Z: 250,
        },
      };

      const contours = parser.parse(geojson);

      expect(contours).toHaveLength(1);
      expect(contours[0].elevation).toBe(250);
    });
  });

  describe('Invalid GeoJSON handling', () => {
    it('should throw error for invalid JSON string', () => {
      const invalidJSON = 'not valid json{]';

      expect(() => parser.parse(invalidJSON)).toThrow(TerrainAnalysisError);
      expect(() => parser.parse(invalidJSON)).toThrow('Invalid JSON format');
    });

    it('should throw error for non-LineString geometry', () => {
      const geojson = {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[[-122.0, 37.0], [-121.0, 37.0], [-121.0, 38.0], [-122.0, 37.0]]],
        },
        properties: {
          elevation: 100,
        },
      };

      expect(() => parser.parse(geojson)).toThrow(TerrainAnalysisError);
      expect(() => parser.parse(geojson)).toThrow('must be LineString');
    });

    it('should throw error for missing elevation property', () => {
      const geojson = {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [[-122.0, 37.0], [-121.0, 37.0]],
        },
        properties: {
          name: 'Test',
          // No elevation field
        },
      };

      expect(() => parser.parse(geojson)).toThrow(TerrainAnalysisError);
      expect(() => parser.parse(geojson)).toThrow('No elevation attribute found');
    });

    it('should throw error for invalid elevation value', () => {
      const geojson = {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [[-122.0, 37.0], [-121.0, 37.0]],
        },
        properties: {
          elevation: 10000, // > 9000m (invalid)
        },
      };

      expect(() => parser.parse(geojson)).toThrow(TerrainAnalysisError);
      expect(() => parser.parse(geojson)).toThrow('Invalid elevation value');
    });
  });
});
