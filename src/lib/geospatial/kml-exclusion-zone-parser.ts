/**
 * Story 1.5: KML Exclusion Zone Parser
 *
 * Parses exclusion zones from KML files.
 * Extends KML boundary parser to handle multiple placemarks with metadata.
 */

import { XMLParser } from 'fast-xml-parser';
import type { Polygon, Position } from 'geojson';
import { GeospatialError } from '@/lib/errors/GeospatialError';
import { ExclusionZoneType } from '@prisma/client';

export interface ParsedExclusionZone {
  /** Zone name from KML Placemark */
  name: string;
  /** Zone type (inferred from name or defaults to CUSTOM) */
  type: ExclusionZoneType;
  /** Zone description from KML */
  description?: string;
  /** GeoJSON Polygon geometry */
  geometry: Polygon;
  /** Additional attributes from KML ExtendedData */
  attributes?: Record<string, any>;
}

/**
 * Parses KML files containing exclusion zones (wetlands, easements, protected areas).
 * Can extract multiple zones from a single KML file.
 */
export class KMLExclusionZoneParser {
  private parser: XMLParser;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseTagValue: false,
    });
  }

  /**
   * Parse KML content and extract all exclusion zone geometries.
   *
   * @param kmlContent - KML XML string
   * @param fileId - File ID for error context
   * @returns Array of parsed exclusion zones
   */
  parseAll(kmlContent: string, fileId?: string): ParsedExclusionZone[] {
    try {
      const parsedKML = this.parser.parse(kmlContent);

      if (!parsedKML.kml) {
        throw new GeospatialError('Missing root <kml> element in KML file', {
          fileId,
        });
      }

      const kml = parsedKML.kml;
      const zones = this.extractAllZones(kml, fileId);

      if (zones.length === 0) {
        throw new GeospatialError('No exclusion zones found in KML file', {
          fileId,
          hint: 'KML must contain Placemark elements with Polygon geometries',
        });
      }

      return zones;
    } catch (error) {
      if (error instanceof GeospatialError) {
        throw error;
      }
      throw new GeospatialError(
        `Failed to parse KML: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        { fileId }
      );
    }
  }

  /**
   * Extract all exclusion zones from KML document.
   * Supports multiple Placemarks with Polygon geometries.
   */
  private extractAllZones(
    kml: any,
    fileId?: string
  ): ParsedExclusionZone[] {
    const document = kml.Document || kml;
    const placemarks = this.getPlacemarks(document);

    const zones: ParsedExclusionZone[] = [];

    for (const placemark of placemarks) {
      try {
        // Skip placemarks without polygon geometries
        if (!placemark.Polygon && !placemark.MultiGeometry) {
          continue;
        }

        const zone = this.parsePlacemarkAsZone(placemark, fileId);
        zones.push(zone);
      } catch (error) {
        // Log warning but continue parsing other zones
        console.warn(
          `Skipping invalid placemark: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
    }

    return zones;
  }

  /**
   * Parse a single Placemark as an exclusion zone.
   */
  private parsePlacemarkAsZone(
    placemark: any,
    fileId?: string
  ): ParsedExclusionZone {
    // Extract name (required)
    const name = placemark.name || placemark.Name || 'Unnamed Zone';

    // Extract description (optional)
    const description =
      placemark.description || placemark.Description || undefined;

    // Extract geometry
    let geometry: Polygon;
    if (placemark.Polygon) {
      geometry = this.parsePolygon(placemark.Polygon, fileId);
    } else if (placemark.MultiGeometry) {
      geometry = this.parseMultiGeometry(placemark.MultiGeometry, fileId);
    } else {
      throw new GeospatialError('Placemark missing Polygon geometry', {
        fileId,
      });
    }

    // Infer zone type from name or description
    const type = this.inferZoneType(name, description);

    // Extract extended data attributes (optional)
    const attributes = this.extractExtendedData(placemark.ExtendedData);

    return {
      name,
      type,
      description,
      geometry,
      attributes,
    };
  }

  /**
   * Infer exclusion zone type from name or description.
   * Uses keyword matching to classify zones.
   */
  private inferZoneType(
    name: string,
    description?: string
  ): ExclusionZoneType {
    const text = `${name} ${description || ''}`.toLowerCase();

    // Keyword matching for zone types
    if (text.match(/wetland|marsh|swamp|bog/)) {
      return 'WETLAND';
    }
    if (text.match(/protected|habitat|endangered|species|conservation/)) {
      return 'PROTECTED_AREA';
    }
    if (text.match(/easement|utility|power|electric|gas|sewer|water line/)) {
      return 'EASEMENT';
    }
    if (text.match(/buffer|setback/)) {
      return 'BUFFER';
    }
    if (text.match(/setback|minimum distance/)) {
      return 'SETBACK';
    }

    // Default to CUSTOM if no keywords matched
    return 'CUSTOM';
  }

  /**
   * Extract attributes from KML ExtendedData element.
   */
  private extractExtendedData(
    extendedData: any
  ): Record<string, any> | undefined {
    if (!extendedData) {
      return undefined;
    }

    const attributes: Record<string, any> = {};

    // Handle Data elements (name-value pairs)
    if (extendedData.Data) {
      const dataArray = Array.isArray(extendedData.Data)
        ? extendedData.Data
        : [extendedData.Data];

      for (const data of dataArray) {
        const name = data['@_name'];
        const value = data.value || data.Value;
        if (name && value) {
          attributes[name] = value;
        }
      }
    }

    // Handle SchemaData elements
    if (extendedData.SchemaData) {
      const schemaData = Array.isArray(extendedData.SchemaData)
        ? extendedData.SchemaData[0]
        : extendedData.SchemaData;

      if (schemaData.SimpleData) {
        const simpleDataArray = Array.isArray(schemaData.SimpleData)
          ? schemaData.SimpleData
          : [schemaData.SimpleData];

        for (const simpleData of simpleDataArray) {
          const name = simpleData['@_name'];
          const value = simpleData['#text'];
          if (name && value) {
            attributes[name] = value;
          }
        }
      }
    }

    return Object.keys(attributes).length > 0 ? attributes : undefined;
  }

  /**
   * Get all Placemark elements from KML document.
   * Recursively searches through Folders.
   */
  private getPlacemarks(document: any): any[] {
    const placemarks: any[] = [];

    if (document.Placemark) {
      const placemarkArray = Array.isArray(document.Placemark)
        ? document.Placemark
        : [document.Placemark];
      placemarks.push(...placemarkArray);
    }

    if (document.Folder) {
      const folders = Array.isArray(document.Folder)
        ? document.Folder
        : [document.Folder];
      for (const folder of folders) {
        placemarks.push(...this.getPlacemarks(folder));
      }
    }

    return placemarks;
  }

  /**
   * Parse KML Polygon element to GeoJSON Polygon.
   * Reuses logic from KMLBoundaryParser.
   */
  private parsePolygon(polygon: any, fileId?: string): Polygon {
    const outerBoundary = polygon.outerBoundaryIs || polygon.OuterBoundaryIs;
    if (!outerBoundary || !outerBoundary.LinearRing) {
      throw new GeospatialError('Polygon missing outerBoundaryIs/LinearRing', {
        fileId,
      });
    }

    const coordinates = this.parseCoordinates(
      outerBoundary.LinearRing.coordinates,
      fileId
    );

    // Handle inner boundaries (holes)
    const holes: Position[][] = [];
    const innerBoundaries = polygon.innerBoundaryIs || polygon.InnerBoundaryIs;
    if (innerBoundaries) {
      const innerArray = Array.isArray(innerBoundaries)
        ? innerBoundaries
        : [innerBoundaries];
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
   * Parse KML MultiGeometry element.
   * Takes first polygon from multi-geometry.
   */
  private parseMultiGeometry(multiGeometry: any, fileId?: string): Polygon {
    if (multiGeometry.Polygon) {
      const polygons = Array.isArray(multiGeometry.Polygon)
        ? multiGeometry.Polygon
        : [multiGeometry.Polygon];
      return this.parsePolygon(polygons[0], fileId);
    }

    throw new GeospatialError('MultiGeometry contains no Polygon elements', {
      fileId,
    });
  }

  /**
   * Parse KML coordinates string to GeoJSON coordinates.
   * KML format: "lng,lat,alt lng,lat,alt ..."
   * GeoJSON format: [[lng, lat, alt], [lng, lat, alt], ...]
   */
  private parseCoordinates(coordString: string, fileId?: string): Position[] {
    if (!coordString || typeof coordString !== 'string') {
      throw new GeospatialError('Invalid or missing coordinates in KML', {
        fileId,
        expected: 'longitude,latitude,altitude string',
        received: typeof coordString,
      });
    }

    try {
      const coordPairs = coordString
        .trim()
        .split(/\s+/)
        .filter(Boolean);

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
        throw new GeospatialError(
          'Polygon must have at least 4 coordinates (including closing point)',
          {
            fileId,
            received: coordinates.length,
          }
        );
      }

      return coordinates;
    } catch (error) {
      if (error instanceof GeospatialError) {
        throw error;
      }
      throw new GeospatialError(
        `Failed to parse coordinates: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        { fileId }
      );
    }
  }
}
