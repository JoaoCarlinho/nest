"""
GDAL Operations for Slope Calculation

Core GDAL functionality for slope calculation, classification,
statistics, and visualization generation.
"""

import json
import numpy as np
from typing import Dict, Any, List, Tuple, Optional
from osgeo import gdal, ogr, osr
from scipy.ndimage import gaussian_filter
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend
import matplotlib.pyplot as plt
from matplotlib import colors as mcolors

# Enable GDAL exceptions
gdal.UseExceptions()


def calculate_slope(
    dem_path: str,
    output_path: str,
    smoothing_enabled: bool = False,
    smoothing_kernel_size: int = 3
) -> None:
    """
    Calculate slope percentage from DEM using central difference method.

    Args:
        dem_path: Path to input DEM GeoTIFF
        output_path: Path to output slope GeoTIFF
        smoothing_enabled: Whether to apply Gaussian smoothing
        smoothing_kernel_size: Kernel size for smoothing (3 or 5)
    """
    # Open DEM dataset
    dataset = gdal.Open(dem_path)
    band = dataset.GetRasterBand(1)

    # Get geotransform for cell size
    geotransform = dataset.GetGeoTransform()
    cell_size_x = abs(geotransform[1])  # degrees
    cell_size_y = abs(geotransform[5])  # degrees

    # Convert to meters (approximate at centroid)
    # At equator: 1 degree ≈ 111,320 meters
    # Adjust for latitude
    center_lat = (dataset.RasterYSize * geotransform[5] / 2) + geotransform[3]
    meters_per_degree_x = 111320 * abs(np.cos(np.radians(center_lat)))
    meters_per_degree_y = 111320

    cell_size_x_m = cell_size_x * meters_per_degree_x
    cell_size_y_m = cell_size_y * meters_per_degree_y

    # Read elevation data
    width = dataset.RasterXSize
    height = dataset.RasterYSize
    elevation = band.ReadAsArray().astype(np.float32)

    # Apply smoothing if enabled
    if smoothing_enabled:
        sigma = smoothing_kernel_size / 3.0  # Standard deviation
        elevation = gaussian_filter(elevation, sigma=sigma)

    # Calculate slope using central difference
    slope = np.zeros_like(elevation, dtype=np.float32)

    # Interior cells (central difference)
    for y in range(1, height - 1):
        for x in range(1, width - 1):
            # Central difference for gradients
            dz_dx = (elevation[y, x + 1] - elevation[y, x - 1]) / (2 * cell_size_x_m)
            dz_dy = (elevation[y + 1, x] - elevation[y - 1, x]) / (2 * cell_size_y_m)

            # Slope percentage = sqrt(dz_dx² + dz_dy²) * 100
            slope[y, x] = np.sqrt(dz_dx * dz_dx + dz_dy * dz_dy) * 100

    # Handle edge cases (copy from nearest interior cell)
    # Top and bottom rows
    slope[0, :] = slope[1, :]
    slope[height - 1, :] = slope[height - 2, :]

    # Left and right columns
    slope[:, 0] = slope[:, 1]
    slope[:, width - 1] = slope[:, width - 2]

    # Create output GeoTIFF
    driver = gdal.GetDriverByName('GTiff')
    output_ds = driver.Create(
        output_path,
        width,
        height,
        1,
        gdal.GDT_Float32,
        options=['COMPRESS=LZW', 'TILED=YES']
    )

    # Copy georeferencing
    output_ds.SetGeoTransform(geotransform)
    output_ds.SetProjection(dataset.GetProjection())

    # Write slope data
    output_band = output_ds.GetRasterBand(1)
    output_band.WriteArray(slope)
    output_band.SetDescription('Slope Percentage')
    output_band.SetUnitType('%')
    output_band.SetNoDataValue(-9999)

    # Compute statistics
    output_band.ComputeStatistics(False)

    # Flush and close
    output_band.FlushCache()
    output_ds = None
    dataset = None


def classify_slope(
    slope_path: str,
    output_path: str,
    thresholds: Dict[str, float]
) -> None:
    """
    Classify slope raster into categories.

    Args:
        slope_path: Path to slope percentage GeoTIFF
        output_path: Path to output classified GeoTIFF
        thresholds: Classification thresholds (flat, moderate, steep)
    """
    # Open slope dataset
    dataset = gdal.Open(slope_path)
    band = dataset.GetRasterBand(1)

    width = dataset.RasterXSize
    height = dataset.RasterYSize
    slope = band.ReadAsArray()

    # Classify into categories
    # 1 = flat (0-flat%)
    # 2 = moderate (flat%-moderate%)
    # 3 = steep (moderate%-steep%)
    # 4 = very steep (>steep%)
    classified = np.zeros_like(slope, dtype=np.uint8)

    classified[slope <= thresholds['flat']] = 1
    classified[(slope > thresholds['flat']) & (slope <= thresholds['moderate'])] = 2
    classified[(slope > thresholds['moderate']) & (slope <= thresholds['steep'])] = 3
    classified[slope > thresholds['steep']] = 4

    # Create output dataset
    driver = gdal.GetDriverByName('GTiff')
    output_ds = driver.Create(
        output_path,
        width,
        height,
        1,
        gdal.GDT_Byte,
        options=['COMPRESS=LZW', 'TILED=YES']
    )

    # Copy georeferencing
    output_ds.SetGeoTransform(dataset.GetGeoTransform())
    output_ds.SetProjection(dataset.GetProjection())

    # Write classified data
    output_band = output_ds.GetRasterBand(1)
    output_band.WriteArray(classified)
    output_band.SetDescription('Slope Classification')

    # Add color table for visualization
    color_table = gdal.ColorTable()
    color_table.SetColorEntry(0, (0, 0, 0, 0))         # No data (transparent)
    color_table.SetColorEntry(1, (34, 139, 34, 255))   # Green (flat)
    color_table.SetColorEntry(2, (255, 255, 0, 255))   # Yellow (moderate)
    color_table.SetColorEntry(3, (255, 165, 0, 255))   # Orange (steep)
    color_table.SetColorEntry(4, (255, 0, 0, 255))     # Red (very steep)
    output_band.SetColorTable(color_table)

    # Flush and close
    output_band.FlushCache()
    output_ds = None
    dataset = None


def calculate_slope_statistics(
    slope_path: str,
    thresholds: Dict[str, float],
    max_buildable_slope: float
) -> Dict[str, float]:
    """
    Calculate slope distribution statistics.

    Returns:
        Dictionary with mean, median, max, and category percentages
    """
    dataset = gdal.Open(slope_path)
    band = dataset.GetRasterBand(1)
    slope = band.ReadAsArray()

    # Remove nodata values
    valid_slope = slope[slope != -9999]

    # Calculate basic statistics
    mean_slope = float(np.mean(valid_slope))
    median_slope = float(np.median(valid_slope))
    max_slope = float(np.max(valid_slope))

    # Calculate category percentages
    total_cells = valid_slope.size

    flat_count = np.sum(valid_slope <= thresholds['flat'])
    moderate_count = np.sum((valid_slope > thresholds['flat']) &
                            (valid_slope <= thresholds['moderate']))
    steep_count = np.sum((valid_slope > thresholds['moderate']) &
                         (valid_slope <= thresholds['steep']))
    very_steep_count = np.sum(valid_slope > thresholds['steep'])
    unbuildable_count = np.sum(valid_slope > max_buildable_slope)

    flat_percent = (flat_count / total_cells) * 100
    moderate_percent = (moderate_count / total_cells) * 100
    steep_percent = (steep_count / total_cells) * 100
    very_steep_percent = (very_steep_count / total_cells) * 100
    unbuildable_percent = (unbuildable_count / total_cells) * 100

    dataset = None

    return {
        'meanSlope': mean_slope,
        'medianSlope': median_slope,
        'maxSlope': max_slope,
        'flatPercent': float(flat_percent),
        'moderatePercent': float(moderate_percent),
        'steepPercent': float(steep_percent),
        'verySteepPercent': float(very_steep_percent),
        'unbuildablePercent': float(unbuildable_percent)
    }


def generate_heatmap(
    classified_path: str,
    output_path: str,
    dem_metadata: Dict[str, Any],
    thresholds: Dict[str, float],
    stats: Dict[str, float]
) -> None:
    """
    Generate slope heatmap visualization as PNG.

    Args:
        classified_path: Path to classified slope GeoTIFF
        output_path: Path to output PNG
        dem_metadata: DEM metadata with bounds
        thresholds: Classification thresholds
        stats: Slope statistics for legend
    """
    # Read classified slope
    dataset = gdal.Open(classified_path)
    band = dataset.GetRasterBand(1)
    classified = band.ReadAsArray()

    # Create figure
    fig, ax = plt.subplots(figsize=(12, 10))

    # Define custom colormap matching classification
    cmap = mcolors.ListedColormap([
        '#228B22',  # Green (flat)
        '#FFFF00',  # Yellow (moderate)
        '#FFA500',  # Orange (steep)
        '#FF0000'   # Red (very steep)
    ])
    bounds = [0.5, 1.5, 2.5, 3.5, 4.5]
    norm = mcolors.BoundaryNorm(bounds, cmap.N)

    # Plot classified slope
    im = ax.imshow(
        classified,
        cmap=cmap,
        norm=norm,
        extent=[
            dem_metadata['minLng'],
            dem_metadata['maxLng'],
            dem_metadata['minLat'],
            dem_metadata['maxLat']
        ],
        aspect='auto'
    )

    # Add colorbar legend
    cbar = plt.colorbar(im, ax=ax, ticks=[1, 2, 3, 4], orientation='vertical', pad=0.02)
    cbar.ax.set_yticklabels([
        f'Flat (0-{thresholds["flat"]}%)\n{stats["flatPercent"]:.1f}% of site',
        f'Moderate ({thresholds["flat"]}-{thresholds["moderate"]}%)\n{stats["moderatePercent"]:.1f}% of site',
        f'Steep ({thresholds["moderate"]}-{thresholds["steep"]}%)\n{stats["steepPercent"]:.1f}% of site',
        f'Very Steep (>{thresholds["steep"]}%)\n{stats["verySteepPercent"]:.1f}% of site'
    ])

    # Add title and labels
    ax.set_title(
        f'Slope Analysis Heatmap\nMean Slope: {stats["meanSlope"]:.1f}% | Max Slope: {stats["maxSlope"]:.1f}%',
        fontsize=14,
        fontweight='bold'
    )
    ax.set_xlabel('Longitude', fontsize=12)
    ax.set_ylabel('Latitude', fontsize=12)

    # Add grid
    ax.grid(True, alpha=0.3, linestyle='--')

    # Add north arrow (simple)
    ax.annotate('N', xy=(0.95, 0.95), xycoords='axes fraction',
                fontsize=16, fontweight='bold', ha='center', va='center')
    ax.annotate('↑', xy=(0.95, 0.93), xycoords='axes fraction',
                fontsize=20, ha='center', va='top')

    # Add scale bar (approximate)
    lat_range = dem_metadata['maxLat'] - dem_metadata['minLat']
    scale_km = lat_range * 111.32 / 5  # 1/5 of map width in km
    ax.plot([0.1, 0.1 + (1/5)], [0.05, 0.05], 'k-', linewidth=2, transform=ax.transAxes)
    ax.text(0.1 + (1/10), 0.07, f'{scale_km:.1f} km', transform=ax.transAxes,
            ha='center', fontsize=10)

    # Save figure
    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    plt.close()

    dataset = None


def identify_unbuildable_areas(
    slope_path: str,
    max_buildable_slope: float,
    dem_metadata: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """
    Identify unbuildable areas (slope > threshold) as GeoJSON polygons.

    Args:
        slope_path: Path to slope GeoTIFF
        max_buildable_slope: Maximum buildable slope threshold
        dem_metadata: DEM metadata with bounds and CRS

    Returns:
        GeoJSON FeatureCollection or None if no unbuildable areas
    """
    # Open slope dataset
    dataset = gdal.Open(slope_path)
    band = dataset.GetRasterBand(1)
    slope = band.ReadAsArray()

    # Create binary mask: 1 = unbuildable, 0 = buildable
    unbuildable_mask = (slope > max_buildable_slope).astype(np.uint8)

    # Check if there are any unbuildable areas
    if np.sum(unbuildable_mask) == 0:
        return None

    # Create temporary in-memory raster for mask
    mem_driver = gdal.GetDriverByName('MEM')
    mask_ds = mem_driver.Create('', dataset.RasterXSize, dataset.RasterYSize, 1, gdal.GDT_Byte)
    mask_ds.SetGeoTransform(dataset.GetGeoTransform())
    mask_ds.SetProjection(dataset.GetProjection())
    mask_band = mask_ds.GetRasterBand(1)
    mask_band.WriteArray(unbuildable_mask)

    # Polygonize mask to vectors
    mem_ogr_driver = ogr.GetDriverByName('Memory')
    vector_ds = mem_ogr_driver.CreateDataSource('unbuildable')

    srs = osr.SpatialReference()
    srs.ImportFromWkt(dataset.GetProjection())
    layer = vector_ds.CreateLayer('unbuildable', srs, ogr.wkbPolygon)

    # Add field for slope value
    field_def = ogr.FieldDefn('category', ogr.OFTString)
    layer.CreateField(field_def)

    # Polygonize
    gdal.Polygonize(mask_band, mask_band, layer, 0)

    # Convert to GeoJSON
    features = []
    for feature in layer:
        if feature.GetField(0) == 1:  # Only unbuildable areas
            geom = feature.GetGeometryRef()
            geom_json = json.loads(geom.ExportToJson())

            features.append({
                'type': 'Feature',
                'properties': {
                    'category': 'unbuildable',
                    'maxBuildableSlope': max_buildable_slope
                },
                'geometry': geom_json
            })

    if not features:
        return None

    geojson = {
        'type': 'FeatureCollection',
        'features': features
    }

    # Cleanup
    mask_ds = None
    vector_ds = None
    dataset = None

    return geojson
