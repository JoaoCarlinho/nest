import DxfParser from 'dxf-parser';
import { LineString } from 'geojson';
import { TerrainAnalysisError } from '@/lib/errors/TerrainAnalysisError';
import { isValidElevation } from './elevation-stats';
import { ParsedContour } from './geojson-contour-parser';

/**
 * Parse contour lines from DXF format
 * Basic implementation - DXF is complex CAD format with many entity types
 * This parser extracts POLYLINE/LWPOLYLINE entities and elevation attributes
 */
export class DXFContourParser {
  private parser: DxfParser;

  constructor() {
    this.parser = new DxfParser();
  }

  /**
   * Parse DXF content and extract contour lines with elevations
   * @param dxfContent - DXF file content as string
   * @param fileId - File ID for error context
   * @returns Array of parsed contours with geometry and elevation
   */
  parse(dxfContent: string, fileId?: string): ParsedContour[] {
    try {
      // Parse DXF
      const dxf = this.parser.parseSync(dxfContent);

      if (!dxf || !dxf.entities) {
        throw new TerrainAnalysisError('Invalid DXF file structure', {
          fileId,
          format: 'dxf',
        });
      }

      const contours: ParsedContour[] = [];
      const errors: string[] = [];

      // Extract POLYLINE and LWPOLYLINE entities (typically used for contours)
      for (let i = 0; i < dxf.entities.length; i++) {
        const entity = dxf.entities[i];

        try {
          // Process POLYLINE entities
          if (entity.type === 'POLYLINE' || entity.type === 'LWPOLYLINE') {
            const contour = this.parsePolylineEntity(entity, i);
            if (contour) {
              contours.push(contour);
            }
          }
          // Could also process LINE entities if needed
        } catch (error) {
          errors.push(
            `Entity ${i}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      if (contours.length === 0) {
        throw new TerrainAnalysisError('No valid contour lines found in DXF file', {
          fileId,
          format: 'dxf',
          totalEntities: dxf.entities.length,
          errors: errors.slice(0, 10), // Limit error messages
        });
      }

      return contours;
    } catch (error) {
      if (error instanceof TerrainAnalysisError) {
        throw error;
      }
      throw new TerrainAnalysisError('Failed to parse DXF file', {
        fileId,
        format: 'dxf',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Parse a POLYLINE or LWPOLYLINE entity from DXF
   * @param entity - DXF entity
   * @param index - Entity index for error reporting
   * @returns Parsed contour or null if not valid
   */
  private parsePolylineEntity(entity: any, index: number): ParsedContour | null {
    // Extract vertices from polyline
    const vertices = entity.vertices || [];

    if (vertices.length < 2) {
      return null; // Skip lines with < 2 points
    }

    // Convert vertices to GeoJSON LineString coordinates
    const coordinates: [number, number, number][] = vertices.map((v: any) => [
      v.x || 0,
      v.y || 0,
      v.z || 0,
    ]);

    // Try to find elevation from various sources
    let elevation: number | null = null;

    // Check elevation from entity properties
    if (typeof entity.elevation === 'number') {
      elevation = entity.elevation;
    }
    // Check Z value from first vertex
    else if (typeof vertices[0]?.z === 'number' && vertices[0].z !== 0) {
      elevation = vertices[0].z;
    }
    // Check layer name (sometimes contains elevation, e.g., "CONTOUR_100")
    else if (entity.layer) {
      const match = entity.layer.match(/(\d+)/);
      if (match) {
        const parsedElev = parseFloat(match[1]);
        if (!isNaN(parsedElev)) {
          elevation = parsedElev;
        }
      }
    }

    if (elevation === null) {
      throw new TerrainAnalysisError('No elevation attribute found in DXF entity', {
        entityIndex: index,
        entityType: entity.type,
        layer: entity.layer,
      });
    }

    if (!isValidElevation(elevation)) {
      throw new TerrainAnalysisError('Invalid elevation value in DXF entity', {
        entityIndex: index,
        elevation,
        validRange: '-500m to 9000m',
      });
    }

    const geometry: LineString = {
      type: 'LineString',
      coordinates,
    };

    return {
      geometry,
      elevation,
    };
  }
}
