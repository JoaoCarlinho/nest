import { LineString, Feature, FeatureCollection, Geometry } from 'geojson';
import { TerrainAnalysisError } from '@/lib/errors/TerrainAnalysisError';
import { findElevationField, isValidElevation } from './elevation-stats';

export interface ParsedContour {
  geometry: LineString;
  elevation: number;
}

/**
 * Parse contour lines from GeoJSON format
 */
export class GeoJSONContourParser {
  /**
   * Parse GeoJSON content and extract contour lines with elevations
   * @param geojsonContent - GeoJSON string or object
   * @param fileId - File ID for error context
   * @returns Array of parsed contours with geometry and elevation
   */
  parse(geojsonContent: string | object, fileId?: string): ParsedContour[] {
    let geojson: any;

    // Parse JSON if string
    if (typeof geojsonContent === 'string') {
      try {
        geojson = JSON.parse(geojsonContent);
      } catch (error) {
        throw new TerrainAnalysisError('Invalid JSON format in GeoJSON file', {
          fileId,
          format: 'geojson',
        });
      }
    } else {
      geojson = geojsonContent;
    }

    // Handle both FeatureCollection and single Feature
    let features: Feature[];
    if (geojson.type === 'FeatureCollection') {
      features = geojson.features;
    } else if (geojson.type === 'Feature') {
      features = [geojson];
    } else {
      throw new TerrainAnalysisError('GeoJSON must be Feature or FeatureCollection', {
        fileId,
        format: 'geojson',
        receivedType: geojson.type,
      });
    }

    const contours: ParsedContour[] = [];
    const errors: string[] = [];

    for (let i = 0; i < features.length; i++) {
      const feature = features[i];

      try {
        const contour = this.parseFeature(feature, i);
        if (contour) {
          contours.push(contour);
        }
      } catch (error) {
        // For single feature inputs, throw the error immediately with specific message
        if (features.length === 1) {
          throw error;
        }

        // For multi-feature inputs, collect errors and continue
        if (error instanceof TerrainAnalysisError) {
          errors.push(`Feature ${i}: ${error.message}`);
        } else {
          errors.push(`Feature ${i}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    if (contours.length === 0) {
      throw new TerrainAnalysisError('No valid contour lines found in GeoJSON', {
        fileId,
        format: 'geojson',
        totalFeatures: features.length,
        errors,
      });
    }

    return contours;
  }

  /**
   * Parse a single GeoJSON feature
   * @param feature - GeoJSON Feature
   * @param index - Feature index for error reporting
   * @returns Parsed contour or null if not a valid contour
   */
  private parseFeature(feature: Feature, index: number): ParsedContour | null {
    // Check geometry type
    if (!feature.geometry || feature.geometry.type !== 'LineString') {
      throw new TerrainAnalysisError('Feature geometry must be LineString for contours', {
        featureIndex: index,
        receivedType: feature.geometry?.type || 'null',
      });
    }

    const geometry = feature.geometry as LineString;

    // Validate coordinates
    if (!geometry.coordinates || geometry.coordinates.length < 2) {
      throw new TerrainAnalysisError('LineString must have at least 2 coordinates', {
        featureIndex: index,
        coordinateCount: geometry.coordinates?.length || 0,
      });
    }

    // Extract elevation from properties
    if (!feature.properties) {
      throw new TerrainAnalysisError('Feature missing properties (elevation attribute required)', {
        featureIndex: index,
      });
    }

    const elevationField = findElevationField(feature.properties);
    if (!elevationField) {
      throw new TerrainAnalysisError('No elevation attribute found in feature properties', {
        featureIndex: index,
        availableFields: Object.keys(feature.properties),
        expectedFields: ['elevation', 'ELEV', 'Z', 'HEIGHT', 'LEVEL'],
      });
    }

    const elevation = feature.properties[elevationField];

    // Validate elevation
    if (!isValidElevation(elevation)) {
      throw new TerrainAnalysisError('Invalid elevation value', {
        featureIndex: index,
        elevationField,
        elevation,
        validRange: '- 500m to 9000m',
      });
    }

    return {
      geometry,
      elevation,
    };
  }
}
