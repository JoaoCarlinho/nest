import { XMLParser } from 'fast-xml-parser';
import { Polygon, MultiPolygon, Position } from 'geojson';
import { GeospatialError } from '@/lib/errors/GeospatialError';

/**
 * Parse property boundaries from KML files
 * Extracts Polygon/MultiPolygon geometries and converts to GeoJSON
 */
export class KMLBoundaryParser {
  private parser: XMLParser;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseTagValue: false,
    });
  }

  /**
   * Parse KML content and extract boundary geometry
   * @param kmlContent - KML XML string
   * @param fileId - File ID for error context
   * @returns GeoJSON Polygon geometry
   */
  parse(kmlContent: string, fileId?: string): Polygon {
    try {
      const parsedKML = this.parser.parse(kmlContent);

      if (!parsedKML.kml) {
        throw new GeospatialError('Missing root <kml> element in KML file', {
          fileId,
        });
      }

      const kml = parsedKML.kml;
      const geometry = this.extractGeometry(kml, fileId);

      return geometry;
    } catch (error) {
      if (error instanceof GeospatialError) {
        throw error;
      }
      throw new GeospatialError(
        `Failed to parse KML: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { fileId }
      );
    }
  }

  /**
   * Extract Polygon or MultiPolygon geometry from parsed KML
   * @param kml - Parsed KML object
   * @param fileId - File ID for error context
   * @returns GeoJSON Polygon
   */
  private extractGeometry(kml: any, fileId?: string): Polygon {
    // Navigate through KML structure to find Placemark with Polygon
    const document = kml.Document || kml;
    const placemarks = this.getPlacemarks(document);

    if (!placemarks || placemarks.length === 0) {
      throw new GeospatialError('No Placemark elements found in KML file', {
        fileId,
        expectedElements: ['Placemark'],
      });
    }

    // Find first placemark with Polygon or MultiGeometry
    for (const placemark of placemarks) {
      if (placemark.Polygon) {
        return this.parsePolygon(placemark.Polygon, fileId);
      }
      if (placemark.MultiGeometry) {
        return this.parseMultiGeometry(placemark.MultiGeometry, fileId);
      }
    }

    throw new GeospatialError('No boundary geometry found in KML file', {
      fileId,
      expectedElements: ['Polygon', 'MultiPolygon'],
    });
  }

  /**
   * Get all Placemark elements from KML document
   */
  private getPlacemarks(document: any): any[] {
    if (document.Placemark) {
      return Array.isArray(document.Placemark) ? document.Placemark : [document.Placemark];
    }

    if (document.Folder) {
      const folders = Array.isArray(document.Folder) ? document.Folder : [document.Folder];
      for (const folder of folders) {
        const placemarks = this.getPlacemarks(folder);
        if (placemarks.length > 0) return placemarks;
      }
    }

    return [];
  }

  /**
   * Parse KML Polygon element to GeoJSON Polygon
   */
  private parsePolygon(polygon: any, fileId?: string): Polygon {
    const outerBoundary = polygon.outerBoundaryIs || polygon.OuterBoundaryIs;
    if (!outerBoundary || !outerBoundary.LinearRing) {
      throw new GeospatialError('Polygon missing outerBoundaryIs/LinearRing', { fileId });
    }

    const coordinates = this.parseCoordinates(outerBoundary.LinearRing.coordinates, fileId);

    // Handle inner boundaries (holes)
    const holes: Position[][] = [];
    const innerBoundaries = polygon.innerBoundaryIs || polygon.InnerBoundaryIs;
    if (innerBoundaries) {
      const innerArray = Array.isArray(innerBoundaries) ? innerBoundaries : [innerBoundaries];
      for (const inner of innerArray) {
        if (inner.LinearRing?.coordinates) {
          holes.push(this.parseCoordinates(inner.LinearRing.coordinates, fileId));
        }
      }
    }

    return {
      type: 'Polygon',
      coordinates: [coordinates, ...holes],
    };
  }

  /**
   * Parse KML MultiGeometry element (convert to single Polygon for MVP)
   */
  private parseMultiGeometry(multiGeometry: any, fileId?: string): Polygon {
    // For MVP, take the first polygon from MultiGeometry
    if (multiGeometry.Polygon) {
      const polygons = Array.isArray(multiGeometry.Polygon)
        ? multiGeometry.Polygon
        : [multiGeometry.Polygon];
      return this.parsePolygon(polygons[0], fileId);
    }

    throw new GeospatialError('MultiGeometry contains no Polygon elements', { fileId });
  }

  /**
   * Parse KML coordinates string to GeoJSON coordinates
   * KML format: "lng,lat,alt lng,lat,alt ..." (whitespace or newline separated)
   * GeoJSON format: [[lng, lat, alt], [lng, lat, alt], ...]
   * @param coordString - KML coordinate string
   * @param fileId - File ID for error context
   * @returns Array of [lng, lat, alt] positions
   */
  parseCoordinates(coordString: string, fileId?: string): Position[] {
    if (!coordString || typeof coordString !== 'string') {
      throw new GeospatialError('Invalid or missing coordinates in KML', {
        fileId,
        expected: 'longitude,latitude,altitude string',
        received: typeof coordString,
      });
    }

    try {
      // Split by whitespace and filter empty strings
      const coordPairs = coordString.trim().split(/\s+/).filter(Boolean);

      const coordinates: Position[] = coordPairs.map((pair, index) => {
        const parts = pair.split(',');
        if (parts.length < 2) {
          throw new GeospatialError('Invalid coordinate format in KML', {
            fileId,
            expected: 'longitude,latitude,altitude',
            received: pair,
            line: index + 1,
          });
        }

        const lng = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        const alt = parts[2] ? parseFloat(parts[2]) : 0;

        // Validate coordinate ranges
        if (isNaN(lng) || lng < -180 || lng > 180) {
          throw new GeospatialError('Invalid longitude value', {
            fileId,
            received: lng,
            expected: 'Range: -180 to 180',
            line: index + 1,
          });
        }

        if (isNaN(lat) || lat < -90 || lat > 90) {
          throw new GeospatialError('Invalid latitude value', {
            fileId,
            received: lat,
            expected: 'Range: -90 to 90',
            line: index + 1,
          });
        }

        return [lng, lat, alt];
      });

      if (coordinates.length < 4) {
        throw new GeospatialError('Polygon must have at least 4 coordinates (including closing point)', {
          fileId,
          received: coordinates.length,
        });
      }

      return coordinates;
    } catch (error) {
      if (error instanceof GeospatialError) {
        throw error;
      }
      throw new GeospatialError(
        `Failed to parse coordinates: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { fileId }
      );
    }
  }
}
