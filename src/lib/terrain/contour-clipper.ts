import * as turf from '@turf/turf';
import { LineString, Polygon, Feature } from 'geojson';

/**
 * Clip contour lines to property boundary with buffer
 * Reduces dataset size by removing contours outside the area of interest
 */
export class ContourClipper {
  /**
   * Clip contours to buffered boundary
   * @param contours - Array of LineString geometries (contour lines)
   * @param boundaryPolygon - Property boundary polygon
   * @param bufferMeters - Buffer distance in meters (default 100m)
   * @returns Array of clipped contour LineStrings
   */
  clipToBoundary(
    contours: LineString[],
    boundaryPolygon: Polygon,
    bufferMeters: number = 100
  ): LineString[] {
    // Create buffered boundary
    const boundary = turf.polygon(boundaryPolygon.coordinates);
    const buffered = turf.buffer(boundary, bufferMeters, { units: 'meters' });

    if (!buffered) {
      throw new Error('Failed to create buffered boundary');
    }

    const bufferedPolygon = buffered.geometry as Polygon;
    const bbox = turf.bbox(buffered);

    // Clip each contour
    const clipped: LineString[] = [];

    for (const contour of contours) {
      try {
        const line = turf.lineString(contour.coordinates);

        // Quick bbox check first (fast rejection)
        const lineBbox = turf.bbox(line);
        if (!this.bboxIntersects(lineBbox, bbox)) {
          continue; // Contour completely outside buffer
        }

        // Clip line to buffered boundary
        const clippedLine = turf.bboxClip(line, bbox);

        // Check if clipped line has meaningful length
        if (clippedLine.geometry.coordinates.length >= 2) {
          // Further refine by checking if line actually intersects the buffered polygon
          const intersects = turf.booleanIntersects(clippedLine, buffered);
          if (intersects) {
            clipped.push(clippedLine.geometry);
          }
        }
      } catch (error) {
        // Skip contours that fail to clip (malformed geometry, etc.)
        console.warn('Failed to clip contour:', error);
        continue;
      }
    }

    return clipped;
  }

  /**
   * Check if two bounding boxes intersect
   * @param bbox1 - [minX, minY, maxX, maxY]
   * @param bbox2 - [minX, minY, maxX, maxY]
   * @returns true if bounding boxes overlap
   */
  private bboxIntersects(bbox1: number[], bbox2: number[]): boolean {
    return !(
      bbox1[2] < bbox2[0] || // bbox1 is left of bbox2
      bbox1[0] > bbox2[2] || // bbox1 is right of bbox2
      bbox1[3] < bbox2[1] || // bbox1 is below bbox2
      bbox1[1] > bbox2[3] // bbox1 is above bbox2
    );
  }
}
