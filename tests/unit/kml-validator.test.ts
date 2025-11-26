import { describe, it, expect } from 'vitest';
import { validateKML } from '@/lib/file-processing/kml-validator';
import { readFileSync } from 'fs';
import { join } from 'path';

const FIXTURES_DIR = join(__dirname, '../fixtures');

describe('KML Validator', () => {
  describe('Valid KML', () => {
    it('should validate a simple property boundary KML', () => {
      const kmlContent = readFileSync(
        join(FIXTURES_DIR, 'valid-property-boundary.kml'),
        'utf-8'
      );

      const result = validateKML(kmlContent);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should validate KML with Point geometry', () => {
      const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark>
    <name>Test Point</name>
    <Point>
      <coordinates>-122.0856,37.4224,0</coordinates>
    </Point>
  </Placemark>
</kml>`;

      const result = validateKML(kml);

      expect(result.valid).toBe(true);
    });
  });

  describe('Invalid KML Structure', () => {
    it('should reject malformed XML', () => {
      // Invalid XML - not even XML format
      const kmlContent = `This is not XML at all! Just plain text < > & tags`;

      const result = validateKML(kmlContent);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      // Should fail either with parse error or missing kml element
      const hasError = result.errors?.some(e =>
        e.message.includes('Invalid XML structure') ||
        e.message.includes('Missing root')
      );
      expect(hasError).toBe(true);
    });

    it('should reject KML missing root element', () => {
      const kml = `<?xml version="1.0" encoding="UTF-8"?>
<Document>
  <Placemark><name>Test</name></Placemark>
</Document>`;

      const result = validateKML(kml);

      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.message.includes('root <kml>'))).toBe(true);
    });

    it('should reject KML missing coordinates', () => {
      const kmlContent = readFileSync(
        join(FIXTURES_DIR, 'invalid-missing-coordinates.kml'),
        'utf-8'
      );

      const result = validateKML(kmlContent);

      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.message.includes('coordinates'))).toBe(true);
    });
  });

  describe('Coordinate Validation', () => {
    it('should reject coordinates out of range (latitude)', () => {
      const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark>
    <Point>
      <coordinates>-122.0856,91.0,0</coordinates>
    </Point>
  </Placemark>
</kml>`;

      const result = validateKML(kml);

      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.message.includes('Latitude') && e.message.includes('out of range'))).toBe(true);
    });

    it('should reject coordinates out of range (longitude)', () => {
      const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark>
    <Point>
      <coordinates>-181.0,37.4224,0</coordinates>
    </Point>
  </Placemark>
</kml>`;

      const result = validateKML(kml);

      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.message.includes('Longitude') && e.message.includes('out of range'))).toBe(true);
    });

    it('should reject non-numeric coordinates', () => {
      const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark>
    <Point>
      <coordinates>abc,def,0</coordinates>
    </Point>
  </Placemark>
</kml>`;

      const result = validateKML(kml);

      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.message.includes('not a valid number'))).toBe(true);
    });
  });
});
