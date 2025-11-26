"""
GDAL Operations for DEM Generation

Core GDAL functionality for grid interpolation, GeoTIFF creation,
and DEM statistics calculation.
"""

import json
import numpy as np
from typing import List, Dict, Any, Tuple
from osgeo import gdal, ogr, osr

# Enable GDAL exceptions
gdal.UseExceptions()


def create_contour_vrt(contours: List[Dict[str, Any]], vrt_path: str) -> None:
    """
    Create GDAL VRT (Virtual Format) file from contour data.

    VRT allows GDAL to treat in-memory data as a file source.

    Args:
        contours: List of contour dictionaries with geometry and elevation
        vrt_path: Output path for VRT file
    """
    # Create memory driver
    driver = ogr.GetDriverByName('Memory')
    ds = driver.CreateDataSource('contours')

    # Create layer with WGS84 spatial reference
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(4326)
    layer = ds.CreateLayer('contours', srs, ogr.wkbLineString)

    # Add elevation field
    field_def = ogr.FieldDefn('elevation', ogr.OFTReal)
    layer.CreateField(field_def)

    # Add contours to layer
    for contour in contours:
        feature = ogr.Feature(layer.GetLayerDefn())
        feature.SetField('elevation', contour['elevation'])

        # Create geometry from GeoJSON
        geometry_json = json.dumps(contour['geometry'])
        geometry = ogr.CreateGeometryFromJson(geometry_json)
        feature.SetGeometry(geometry)

        layer.CreateFeature(feature)
        feature = None

    # Save as VRT
    vrt_driver = ogr.GetDriverByName('VRT')
    vrt_ds = vrt_driver.CopyDataSource(ds, vrt_path)
    vrt_ds = None
    ds = None


def run_gdal_grid(
    vrt_path: str,
    bounds: Dict[str, float],
    width: int,
    height: int,
    interpolation_method: str
) -> np.ndarray:
    """
    Run GDAL grid interpolation to generate DEM array.

    Args:
        vrt_path: Path to VRT file with contour data
        bounds: Geographic bounds (minLat, maxLat, minLng, maxLng)
        width: Grid width in pixels
        height: Grid height in pixels
        interpolation_method: 'tin', 'idw', or 'kriging'

    Returns:
        2D numpy array with elevation values
    """
    # Configure algorithm based on method
    if interpolation_method == 'tin':
        algorithm = 'linear:radius=0:nodata=-9999'
    elif interpolation_method == 'idw':
        algorithm = 'invdist:power=2.0:smoothing=0.0:radius1=100:radius2=100:max_points=12:min_points=0:nodata=-9999'
    elif interpolation_method == 'kriging':
        # Use IDW as fallback (kriging not directly supported in gdal_grid)
        algorithm = 'invdist:power=1.5:smoothing=1.0:radius1=200:radius2=200:max_points=20:min_points=4:nodata=-9999'
    else:
        raise ValueError(f"Unknown interpolation method: {interpolation_method}")

    # Create output dataset in memory
    mem_driver = gdal.GetDriverByName('MEM')
    output_ds = mem_driver.Create('', width, height, 1, gdal.GDT_Float32)

    # Set geotransform
    geotransform = [
        bounds['minLng'],                           # top-left X
        (bounds['maxLng'] - bounds['minLng']) / width,  # pixel width
        0,                                          # rotation (0 for north-up)
        bounds['maxLat'],                           # top-left Y
        0,                                          # rotation (0 for north-up)
        -(bounds['maxLat'] - bounds['minLat']) / height  # pixel height (negative)
    ]
    output_ds.SetGeoTransform(geotransform)

    # Set projection (WGS84)
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(4326)
    output_ds.SetProjection(srs.ExportToWkt())

    # Run grid interpolation
    options = gdal.GridOptions(
        algorithm=algorithm,
        outputBounds=[bounds['minLng'], bounds['minLat'], bounds['maxLng'], bounds['maxLat']],
        width=width,
        height=height,
        outputType=gdal.GDT_Float32,
        zfield='elevation'
    )

    gdal.Grid(output_ds, vrt_path, options=options)

    # Read array
    band = output_ds.GetRasterBand(1)
    dem_array = band.ReadAsArray()

    # Replace nodata with NaN
    dem_array = np.where(dem_array == -9999, np.nan, dem_array)

    # Fill NaN values with nearest neighbor interpolation
    dem_array = fill_nodata(dem_array)

    output_ds = None

    return dem_array


def fill_nodata(array: np.ndarray) -> np.ndarray:
    """
    Fill NaN values in DEM array using nearest neighbor interpolation.

    Args:
        array: 2D array with NaN values

    Returns:
        Array with NaN values filled
    """
    from scipy.ndimage import distance_transform_edt

    # Create mask of valid data
    mask = np.isnan(array)

    if not mask.any():
        return array  # No NaN values

    # Find indices of nearest valid data
    indices = distance_transform_edt(
        mask,
        return_distances=False,
        return_indices=True
    )

    # Fill NaN values with nearest neighbor
    filled = array[tuple(indices)]

    return filled


def create_geotiff(
    dem_array: np.ndarray,
    bounds: Dict[str, float],
    resolution: float,
    output_path: str
) -> None:
    """
    Create georeferenced GeoTIFF from DEM array.

    Args:
        dem_array: 2D numpy array with elevation values
        bounds: Geographic bounds
        resolution: Grid resolution in meters
        output_path: Output GeoTIFF path
    """
    height, width = dem_array.shape

    # Create GeoTIFF
    driver = gdal.GetDriverByName('GTiff')
    ds = driver.Create(
        output_path,
        width,
        height,
        1,
        gdal.GDT_Float32,
        options=['COMPRESS=LZW', 'TILED=YES', 'BIGTIFF=IF_SAFER']
    )

    # Set geotransform
    geotransform = [
        bounds['minLng'],
        (bounds['maxLng'] - bounds['minLng']) / width,
        0,
        bounds['maxLat'],
        0,
        -(bounds['maxLat'] - bounds['minLat']) / height
    ]
    ds.SetGeoTransform(geotransform)

    # Set projection (WGS84)
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(4326)
    ds.SetProjection(srs.ExportToWkt())

    # Write DEM array to band
    band = ds.GetRasterBand(1)
    band.WriteArray(dem_array)
    band.SetNoDataValue(-9999)

    # Set metadata
    band.SetDescription('Elevation')
    band.SetUnitType('m')

    # Compute statistics
    band.ComputeStatistics(False)

    # Flush to disk
    band.FlushCache()
    ds = None


def calculate_dem_stats(dem_path: str) -> Dict[str, float]:
    """
    Calculate elevation statistics from DEM GeoTIFF.

    Returns:
        Dictionary with min, max, avg elevations
    """
    ds = gdal.Open(dem_path)
    band = ds.GetRasterBand(1)
    array = band.ReadAsArray()

    # Remove nodata values
    valid_data = array[array != -9999]

    stats = {
        'min': float(np.min(valid_data)),
        'max': float(np.max(valid_data)),
        'avg': float(np.mean(valid_data))
    }

    ds = None

    return stats
