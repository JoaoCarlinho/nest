import { describe, it, expect } from 'vitest';
import { KMLBoundaryParser } from '@/lib/geospatial/kml-boundary-parser';
import { GeospatialError } from '@/lib/errors/GeospatialError';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('KMLBoundaryParser', () => {
  const parser = new KMLBoundaryParser();
  const fixturesPath = join(__dirname, '../fixtures/boundaries');

  describe('Valid KML parsing', () => {
    it('should parse simple rectangular boundary', () => {
      const kml = readFileSync(join(fixturesPath, 'valid-simple-boundary.kml'), 'utf-8');

      const geometry = parser.parse(kml);

      expect(geometry.type).toBe('Polygon');
      expect(geometry.coordinates).toHaveLength(1); // No holes
      expect(geometry.coordinates[0]).toHaveLength(5); // 4 points + closing point
      // Check first and last points are the same (closed)
      expect(geometry.coordinates[0][0]).toEqual(geometry.coordinates[0][4]);
    });

    it('should parse complex boundary with many vertices', () => {
      const kml = readFileSync(join(fixturesPath, 'valid-complex-boundary.kml'), 'utf-8');

      const geometry = parser.parse(kml);

      expect(geometry.type).toBe('Polygon');
      expect(geometry.coordinates[0].length).toBeGreaterThan(10);
      // Verify first and last points match
      const ring = geometry.coordinates[0];
      expect(ring[0]).toEqual(ring[ring.length - 1]);
    });

    it('should parse polygon with inner boundary (hole)', () => {
      const kml = readFileSync(join(fixturesPath, 'valid-multi-polygon-boundary.kml'), 'utf-8');

      const geometry = parser.parse(kml);

      expect(geometry.type).toBe('Polygon');
      expect(geometry.coordinates).toHaveLength(2); // Outer + 1 hole
      expect(geometry.coordinates[0]).toHaveLength(5); // Outer ring
      expect(geometry.coordinates[1]).toHaveLength(5); // Inner ring (hole)
    });

    it('should extract coordinates in correct GeoJSON format [lng, lat, alt]', () => {
      const kml = readFileSync(join(fixturesPath, 'valid-simple-boundary.kml'), 'utf-8');

      const geometry = parser.parse(kml);

      const firstPoint = geometry.coordinates[0][0];
      expect(firstPoint).toHaveLength(3);
      expect(firstPoint[0]).toBeCloseTo(-122.4194); // Longitude
      expect(firstPoint[1]).toBeCloseTo(37.7749); // Latitude
      expect(firstPoint[2]).toBe(0); // Altitude
    });
  });

  describe('Invalid KML handling', () => {
    it('should throw error for missing root kml element', () => {
      const invalidKML = `<?xml version="1.0"?><Document><Placemark></Placemark></Document>`;

      expect(() => parser.parse(invalidKML)).toThrow(GeospatialError);
      expect(() => parser.parse(invalidKML)).toThrow('Missing root <kml> element');
    });

    it('should throw error for missing geometry', () => {
      const kml = readFileSync(join(fixturesPath, 'invalid-missing-geometry.kml'), 'utf-8');

      expect(() => parser.parse(kml)).toThrow(GeospatialError);
      expect(() => parser.parse(kml)).toThrow('No boundary geometry found');
    });

    it('should throw error for invalid coordinate format', () => {
      const invalidKML = `<?xml version="1.0"?>
        <kml xmlns="http://www.opengis.net/kml/2.2">
          <Document>
            <Placemark>
              <Polygon>
                <outerBoundaryIs>
                  <LinearRing>
                    <coordinates>invalid,data,here</coordinates>
                  </LinearRing>
                </outerBoundaryIs>
              </Polygon>
            </Placemark>
          </Document>
        </kml>`;

      expect(() => parser.parse(invalidKML)).toThrow(GeospatialError);
    });

    it('should throw error for longitude out of range', () => {
      const invalidKML = `<?xml version="1.0"?>
        <kml xmlns="http://www.opengis.net/kml/2.2">
          <Document>
            <Placemark>
              <Polygon>
                <outerBoundaryIs>
                  <LinearRing>
                    <coordinates>
                      -200.0,37.0,0
                      -180.0,37.0,0
                      -180.0,38.0,0
                      -200.0,38.0,0
                      -200.0,37.0,0
                    </coordinates>
                  </LinearRing>
                </outerBoundaryIs>
              </Polygon>
            </Placemark>
          </Document>
        </kml>`;

      expect(() => parser.parse(invalidKML)).toThrow(GeospatialError);
      expect(() => parser.parse(invalidKML)).toThrow('Invalid longitude value');
    });

    it('should throw error for latitude out of range', () => {
      const invalidKML = `<?xml version="1.0"?>
        <kml xmlns="http://www.opengis.net/kml/2.2">
          <Document>
            <Placemark>
              <Polygon>
                <outerBoundaryIs>
                  <LinearRing>
                    <coordinates>
                      -122.0,100.0,0
                      -121.0,100.0,0
                      -121.0,90.0,0
                      -122.0,90.0,0
                      -122.0,100.0,0
                    </coordinates>
                  </LinearRing>
                </outerBoundaryIs>
              </Polygon>
            </Placemark>
          </Document>
        </kml>`;

      expect(() => parser.parse(invalidKML)).toThrow(GeospatialError);
      expect(() => parser.parse(invalidKML)).toThrow('Invalid latitude value');
    });

    it('should throw error for too few coordinates', () => {
      const invalidKML = `<?xml version="1.0"?>
        <kml xmlns="http://www.opengis.net/kml/2.2">
          <Document>
            <Placemark>
              <Polygon>
                <outerBoundaryIs>
                  <LinearRing>
                    <coordinates>
                      -122.0,37.0,0
                      -121.0,37.0,0
                    </coordinates>
                  </LinearRing>
                </outerBoundaryIs>
              </Polygon>
            </Placemark>
          </Document>
        </kml>`;

      expect(() => parser.parse(invalidKML)).toThrow(GeospatialError);
      expect(() => parser.parse(invalidKML)).toThrow('at least 4 coordinates');
    });
  });

  describe('Coordinate parsing', () => {
    it('should parse whitespace-separated coordinates', () => {
      const coordString = `-122.4194,37.7749,0 -122.4184,37.7749,0 -122.4184,37.7759,0 -122.4194,37.7759,0 -122.4194,37.7749,0`;

      const coords = parser.parseCoordinates(coordString);

      expect(coords).toHaveLength(5);
      expect(coords[0]).toEqual([-122.4194, 37.7749, 0]);
    });

    it('should parse newline-separated coordinates', () => {
      const coordString = `-122.4194,37.7749,0
        -122.4184,37.7749,0
        -122.4184,37.7759,0
        -122.4194,37.7759,0
        -122.4194,37.7749,0`;

      const coords = parser.parseCoordinates(coordString);

      expect(coords).toHaveLength(5);
      expect(coords[0]).toEqual([-122.4194, 37.7749, 0]);
    });

    it('should handle coordinates without altitude (default to 0)', () => {
      const coordString = `-122.0,37.0 -121.0,37.0 -121.0,38.0 -122.0,38.0 -122.0,37.0`;

      const coords = parser.parseCoordinates(coordString);

      expect(coords[0]).toEqual([-122.0, 37.0, 0]);
    });
  });
});
