"""
DEM Validation Logic

Validates generated DEM by sampling at contour locations and comparing
elevations. Calculates RMSE and match percentage metrics.
"""

import numpy as np
from typing import List, Dict, Any
from osgeo import gdal


def validate_dem(
    dem_path: str,
    contours: List[Dict[str, Any]],
    bounds: Dict[str, float],
    resolution: float
) -> Dict[str, float]:
    """
    Validate DEM by sampling at contour locations.

    Compares DEM elevations with original contour elevations to calculate:
    - RMSE (Root Mean Square Error)
    - Max deviation
    - Percentage of contours within tolerance

    Args:
        dem_path: Path to GeoTIFF DEM file
        contours: Original contour data with geometries and elevations
        bounds: Geographic bounds
        resolution: Grid resolution in meters

    Returns:
        Dictionary with validation metrics
    """
    # Open DEM
    ds = gdal.Open(dem_path)
    band = ds.GetRasterBand(1)
    dem_array = band.ReadAsArray()
    geotransform = ds.GetGeoTransform()

    errors = []
    tolerance = 0.5  # meters

    # Sample DEM at contour point locations
    for contour in contours:
        contour_elevation = contour['elevation']
        geometry = contour['geometry']

        # Extract coordinates from LineString geometry
        if geometry['type'] == 'LineString':
            coordinates = geometry['coordinates']

            # Sample every 10th point to avoid oversampling
            sample_interval = max(1, len(coordinates) // 20)

            for i in range(0, len(coordinates), sample_interval):
                coord = coordinates[i]
                lng, lat = coord[0], coord[1]

                # Convert geographic coordinates to pixel indices
                px, py = geo_to_pixel(lng, lat, geotransform)

                # Check if within bounds
                if 0 <= px < dem_array.shape[1] and 0 <= py < dem_array.shape[0]:
                    dem_elevation = dem_array[py, px]

                    # Skip nodata values
                    if dem_elevation != -9999 and not np.isnan(dem_elevation):
                        error = abs(dem_elevation - contour_elevation)
                        errors.append(error)

    ds = None

    if len(errors) == 0:
        raise ValueError("No valid elevation samples for validation")

    # Calculate metrics
    errors_array = np.array(errors)
    rmse = np.sqrt(np.mean(errors_array ** 2))
    max_deviation = np.max(errors_array)
    within_tolerance = np.sum(errors_array <= tolerance) / len(errors) * 100

    return {
        'rmse': float(rmse),
        'maxDeviation': float(max_deviation),
        'contourMatchPercentage': float(within_tolerance),
        'sampleCount': len(errors)
    }


def geo_to_pixel(lng: float, lat: float, geotransform: tuple) -> tuple:
    """
    Convert geographic coordinates to pixel indices.

    Args:
        lng: Longitude
        lat: Latitude
        geotransform: GDAL geotransform tuple

    Returns:
        Tuple of (pixel_x, pixel_y)
    """
    origin_x = geotransform[0]
    origin_y = geotransform[3]
    pixel_width = geotransform[1]
    pixel_height = geotransform[5]

    px = int((lng - origin_x) / pixel_width)
    py = int((lat - origin_y) / pixel_height)

    return px, py
