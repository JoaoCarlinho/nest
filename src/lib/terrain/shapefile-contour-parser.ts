import AdmZip from 'adm-zip';
import shapefile from 'shapefile';
import { LineString } from 'geojson';
import { TerrainAnalysisError } from '@/lib/errors/TerrainAnalysisError';
import { findElevationField, isValidElevation } from './elevation-stats';
import { ParsedContour } from './geojson-contour-parser';

/**
 * Parse contour lines from Shapefile format (.zip containing .shp, .shx, .dbf)
 * Basic implementation - requires refinement for production use
 */
export class ShapefileContourParser {
  /**
   * Parse Shapefile ZIP and extract contour lines with elevations
   * @param zipBuffer - Buffer containing Shapefile ZIP
   * @param fileId - File ID for error context
   * @returns Array of parsed contours with geometry and elevation
   */
  async parse(zipBuffer: Buffer, fileId?: string): Promise<ParsedContour[]> {
    try {
      // Extract files from ZIP
      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();

      // Find required files
      const shpEntry = entries.find((e) => e.entryName.endsWith('.shp'));
      const dbfEntry = entries.find((e) => e.entryName.endsWith('.dbf'));

      if (!shpEntry || !dbfEntry) {
        throw new TerrainAnalysisError('Shapefile ZIP must contain .shp and .dbf files', {
          fileId,
          format: 'shapefile',
          filesFound: entries.map((e) => e.entryName),
        });
      }

      // Extract buffers
      const shpBuffer = shpEntry.getData();
      const dbfBuffer = dbfEntry.getData();

      // Parse shapefile using shapefile library
      const source = await shapefile.open(shpBuffer, dbfBuffer);
      const contours: ParsedContour[] = [];
      const errors: string[] = [];
      let featureIndex = 0;

      // Read all features
      let result = await source.read();
      while (!result.done) {
        try {
          const feature = result.value;

          // Only process LineString geometries (contours)
          if (feature.geometry && feature.geometry.type === 'LineString') {
            const geometry = feature.geometry as LineString;

            // Find elevation field
            const elevationField = feature.properties ? findElevationField(feature.properties) : null;

            if (!elevationField) {
              errors.push(
                `Feature ${featureIndex}: No elevation attribute found`
              );
            } else {
              const elevation = feature.properties[elevationField];

              if (isValidElevation(elevation)) {
                contours.push({
                  geometry,
                  elevation,
                });
              } else {
                errors.push(
                  `Feature ${featureIndex}: Invalid elevation value ${elevation}`
                );
              }
            }
          }

          featureIndex++;
          result = await source.read();
        } catch (error) {
          errors.push(
            `Feature ${featureIndex}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
          featureIndex++;
          result = await source.read();
        }
      }

      if (contours.length === 0) {
        throw new TerrainAnalysisError('No valid contour lines found in Shapefile', {
          fileId,
          format: 'shapefile',
          totalFeatures: featureIndex,
          errors: errors.slice(0, 10), // Limit error messages
        });
      }

      return contours;
    } catch (error) {
      if (error instanceof TerrainAnalysisError) {
        throw error;
      }
      throw new TerrainAnalysisError('Failed to parse Shapefile', {
        fileId,
        format: 'shapefile',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
