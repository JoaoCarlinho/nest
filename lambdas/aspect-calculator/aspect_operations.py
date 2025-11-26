"""
Aspect (Orientation) Analysis Operations

Calculates terrain aspect (compass direction of slope) from a Digital Elevation Model (DEM).
Implements 8-direction classification and circular statistics.

Story 2.2: Aspect (Orientation) Analysis
"""

import numpy as np
import math
import json
from osgeo import gdal, ogr, osr
from typing import Tuple, Dict, Optional
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend
import matplotlib.pyplot as plt
from matplotlib.patches import Wedge
from matplotlib.colors import ListedColormap, BoundaryNorm


def calculate_aspect(
    dem_path: str,
    slope_path: str,
    output_path: str,
    flat_threshold: float = 2.0
) -> None:
    """
    Calculate aspect (0-360 degrees) from DEM using central difference method.

    Args:
        dem_path: Path to DEM GeoTIFF
        slope_path: Path to slope GeoTIFF (for identifying flat areas)
        output_path: Path for output aspect GeoTIFF
        flat_threshold: Slope % below which aspect is undefined (default 2%)

    Aspect formula:
        aspect = atan2(dz/dy, -dz/dx)
        Convert to geographic north: 0° = N, 90° = E, 180° = S, 270° = W
    """
    print(f"Loading DEM from: {dem_path}")
    dem_dataset = gdal.Open(dem_path)
    if not dem_dataset:
        raise ValueError(f"Failed to open DEM: {dem_path}")

    print(f"Loading slope raster from: {slope_path}")
    slope_dataset = gdal.Open(slope_path)
    if not slope_dataset:
        raise ValueError(f"Failed to open slope raster: {slope_path}")

    # Get DEM properties
    width = dem_dataset.RasterXSize
    height = dem_dataset.RasterYSize
    geotransform = dem_dataset.GetGeoTransform()
    projection = dem_dataset.GetProjection()

    # Calculate cell size in meters
    cell_size_x_deg = geotransform[1]
    cell_size_y_deg = abs(geotransform[5])

    # Convert to meters (approximate at centroid latitude)
    lat = geotransform[3] - (cell_size_y_deg * height / 2)
    meters_per_deg_lat = 111320.0
    meters_per_deg_lng = 111320.0 * math.cos(math.radians(lat))
    cell_size_x_m = cell_size_x_deg * meters_per_deg_lng
    cell_size_y_m = cell_size_y_deg * meters_per_deg_lat

    print(f"Grid size: {width}x{height}, Cell size: {cell_size_x_m:.2f}m x {cell_size_y_m:.2f}m")

    # Read elevation and slope data
    elevation = dem_dataset.GetRasterBand(1).ReadAsArray().astype(np.float32)
    slope = slope_dataset.GetRasterBand(1).ReadAsArray().astype(np.float32)

    # Initialize aspect array (-1 = undefined/flat)
    aspect = np.full((height, width), -1.0, dtype=np.float32)

    print(f"Calculating aspect using central difference method...")

    # Calculate aspect for interior cells
    for y in range(1, height - 1):
        for x in range(1, width - 1):
            # Skip flat areas
            if slope[y, x] < flat_threshold:
                aspect[y, x] = -1.0
                continue

            # Calculate gradients using central difference
            dz_dx = (elevation[y, x + 1] - elevation[y, x - 1]) / (2 * cell_size_x_m)
            dz_dy = (elevation[y + 1, x] - elevation[y - 1, x]) / (2 * cell_size_y_m)

            # Calculate aspect using atan2
            # atan2(dz_dy, -dz_dx) gives aspect from east
            aspect_rad = math.atan2(dz_dy, -dz_dx)

            # Convert to degrees
            aspect_deg = math.degrees(aspect_rad)

            # Convert to geographic north (0° = N, 90° = E, 180° = S, 270° = W)
            aspect_deg = 90 - aspect_deg

            # Normalize to 0-360
            if aspect_deg < 0:
                aspect_deg += 360
            if aspect_deg >= 360:
                aspect_deg -= 360

            aspect[y, x] = aspect_deg

    # Handle edge cells (copy from nearest interior cell)
    print("Handling edge cases...")

    # Top and bottom rows
    for x in range(width):
        if aspect[1, x] != -1:
            aspect[0, x] = aspect[1, x]
        if aspect[height - 2, x] != -1:
            aspect[height - 1, x] = aspect[height - 2, x]

    # Left and right columns
    for y in range(height):
        if aspect[y, 1] != -1:
            aspect[y, 0] = aspect[y, 1]
        if aspect[y, width - 2] != -1:
            aspect[y, width - 1] = aspect[y, width - 2]

    # Create output GeoTIFF
    print(f"Writing aspect raster to: {output_path}")
    driver = gdal.GetDriverByName('GTiff')
    output_dataset = driver.Create(
        output_path,
        width,
        height,
        1,
        gdal.GDT_Float32,
        options=['COMPRESS=LZW']
    )

    output_dataset.SetGeoTransform(geotransform)
    output_dataset.SetProjection(projection)

    output_band = output_dataset.GetRasterBand(1)
    output_band.WriteArray(aspect)
    output_band.SetNoDataValue(-1)
    output_band.FlushCache()

    # Clean up
    dem_dataset = None
    slope_dataset = None
    output_dataset = None

    print("Aspect calculation complete")


def classify_aspect(
    aspect_path: str,
    output_path: str
) -> None:
    """
    Classify aspect into 8 cardinal directions.

    Categories:
        0 = Flat (undefined aspect)
        1 = N   (337.5° - 22.5°)
        2 = NE  (22.5° - 67.5°)
        3 = E   (67.5° - 112.5°)
        4 = SE  (112.5° - 157.5°)
        5 = S   (157.5° - 202.5°)
        6 = SW  (202.5° - 247.5°)
        7 = W   (247.5° - 292.5°)
        8 = NW  (292.5° - 337.5°)

    Args:
        aspect_path: Path to aspect GeoTIFF (0-360°)
        output_path: Path for classified GeoTIFF
    """
    print(f"Loading aspect raster from: {aspect_path}")
    aspect_dataset = gdal.Open(aspect_path)
    if not aspect_dataset:
        raise ValueError(f"Failed to open aspect raster: {aspect_path}")

    width = aspect_dataset.RasterXSize
    height = aspect_dataset.RasterYSize
    geotransform = aspect_dataset.GetGeoTransform()
    projection = aspect_dataset.GetProjection()

    aspect = aspect_dataset.GetRasterBand(1).ReadAsArray()

    # Initialize classified array
    classified = np.zeros((height, width), dtype=np.uint8)

    print("Classifying aspect into 8 cardinal directions...")

    # Classify each cell
    for y in range(height):
        for x in range(width):
            angle = aspect[y, x]

            if angle < 0:
                # Flat area
                classified[y, x] = 0
            elif angle >= 337.5 or angle < 22.5:
                classified[y, x] = 1  # N
            elif 22.5 <= angle < 67.5:
                classified[y, x] = 2  # NE
            elif 67.5 <= angle < 112.5:
                classified[y, x] = 3  # E
            elif 112.5 <= angle < 157.5:
                classified[y, x] = 4  # SE
            elif 157.5 <= angle < 202.5:
                classified[y, x] = 5  # S
            elif 202.5 <= angle < 247.5:
                classified[y, x] = 6  # SW
            elif 247.5 <= angle < 292.5:
                classified[y, x] = 7  # W
            else:  # 292.5 <= angle < 337.5
                classified[y, x] = 8  # NW

    # Create output GeoTIFF
    print(f"Writing classified raster to: {output_path}")
    driver = gdal.GetDriverByName('GTiff')
    output_dataset = driver.Create(
        output_path,
        width,
        height,
        1,
        gdal.GDT_Byte,
        options=['COMPRESS=LZW']
    )

    output_dataset.SetGeoTransform(geotransform)
    output_dataset.SetProjection(projection)

    output_band = output_dataset.GetRasterBand(1)
    output_band.WriteArray(classified)
    output_band.SetNoDataValue(0)

    # Add color table for visualization
    colors = gdal.ColorTable()
    colors.SetColorEntry(0, (128, 128, 128, 255))  # Gray (flat)
    colors.SetColorEntry(1, (255, 0, 0, 255))      # Red (N)
    colors.SetColorEntry(2, (255, 128, 0, 255))    # Orange (NE)
    colors.SetColorEntry(3, (255, 255, 0, 255))    # Yellow (E)
    colors.SetColorEntry(4, (128, 255, 0, 255))    # Yellow-Green (SE)
    colors.SetColorEntry(5, (0, 255, 0, 255))      # Green (S)
    colors.SetColorEntry(6, (0, 255, 255, 255))    # Cyan (SW)
    colors.SetColorEntry(7, (0, 0, 255, 255))      # Blue (W)
    colors.SetColorEntry(8, (128, 0, 255, 255))    # Purple (NW)
    output_band.SetRasterColorTable(colors)

    output_band.FlushCache()

    # Clean up
    aspect_dataset = None
    output_dataset = None

    print("Aspect classification complete")


def calculate_aspect_statistics(aspect_path: str) -> Dict:
    """
    Calculate aspect distribution statistics and circular mean.

    Returns:
        Dictionary with:
            - flatPercent
            - northPercent, northeastPercent, ..., northwestPercent
            - northFacingPercent (N, NE, NW: 315-45°)
            - southFacingPercent (S, SE, SW: 135-225°)
            - dominantDirection ("N", "NE", etc.)
            - circularMeanAspect (degrees, 0-360, or None if too many flat areas)
    """
    print(f"Calculating aspect statistics from: {aspect_path}")
    aspect_dataset = gdal.Open(aspect_path)
    if not aspect_dataset:
        raise ValueError(f"Failed to open aspect raster: {aspect_path}")

    aspect = aspect_dataset.GetRasterBand(1).ReadAsArray()
    aspect_dataset = None

    total_cells = aspect.size

    # Initialize counts
    counts = {
        'flat': 0,
        'N': 0,
        'NE': 0,
        'E': 0,
        'SE': 0,
        'S': 0,
        'SW': 0,
        'W': 0,
        'NW': 0,
        'northFacing': 0,  # N, NE, NW (315-45°)
        'southFacing': 0   # S, SE, SW (135-225°)
    }

    valid_aspects = []

    # Count cells in each category
    for angle in aspect.flat:
        if angle < 0:
            counts['flat'] += 1
        else:
            valid_aspects.append(angle)

            # Classify direction
            if angle >= 337.5 or angle < 22.5:
                counts['N'] += 1
                counts['northFacing'] += 1
            elif 22.5 <= angle < 67.5:
                counts['NE'] += 1
                counts['northFacing'] += 1
            elif 67.5 <= angle < 112.5:
                counts['E'] += 1
            elif 112.5 <= angle < 157.5:
                counts['SE'] += 1
                counts['southFacing'] += 1
            elif 157.5 <= angle < 202.5:
                counts['S'] += 1
                counts['southFacing'] += 1
            elif 202.5 <= angle < 247.5:
                counts['SW'] += 1
                counts['southFacing'] += 1
            elif 247.5 <= angle < 292.5:
                counts['W'] += 1
            else:  # 292.5 <= angle < 337.5
                counts['NW'] += 1
                counts['northFacing'] += 1

    # Calculate percentages
    stats = {
        'flatPercent': (counts['flat'] / total_cells) * 100,
        'northPercent': (counts['N'] / total_cells) * 100,
        'northeastPercent': (counts['NE'] / total_cells) * 100,
        'eastPercent': (counts['E'] / total_cells) * 100,
        'southeastPercent': (counts['SE'] / total_cells) * 100,
        'southPercent': (counts['S'] / total_cells) * 100,
        'southwestPercent': (counts['SW'] / total_cells) * 100,
        'westPercent': (counts['W'] / total_cells) * 100,
        'northwestPercent': (counts['NW'] / total_cells) * 100,
        'northFacingPercent': (counts['northFacing'] / total_cells) * 100,
        'southFacingPercent': (counts['southFacing'] / total_cells) * 100,
        'dominantDirection': _get_dominant_direction(counts),
        'circularMeanAspect': _calculate_circular_mean(valid_aspects) if valid_aspects else None
    }

    print(f"Statistics calculated:")
    print(f"  Flat: {stats['flatPercent']:.1f}%")
    print(f"  North-facing: {stats['northFacingPercent']:.1f}%")
    print(f"  South-facing: {stats['southFacingPercent']:.1f}%")
    print(f"  Dominant direction: {stats['dominantDirection']}")
    if stats['circularMeanAspect'] is not None:
        print(f"  Circular mean aspect: {stats['circularMeanAspect']:.1f}°")

    return stats


def _get_dominant_direction(counts: Dict[str, int]) -> str:
    """Get the cardinal direction with the most cells."""
    directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    max_count = 0
    dominant = 'N'

    for direction in directions:
        if counts[direction] > max_count:
            max_count = counts[direction]
            dominant = direction

    return dominant


def _calculate_circular_mean(aspects: list) -> Optional[float]:
    """
    Calculate circular mean aspect handling 0°/360° wraparound.

    Uses circular statistics to properly average angles.
    """
    if not aspects:
        return None

    # Convert to radians and calculate circular mean
    sum_sin = 0.0
    sum_cos = 0.0

    for aspect in aspects:
        rad = math.radians(aspect)
        sum_sin += math.sin(rad)
        sum_cos += math.cos(rad)

    n = len(aspects)
    mean_rad = math.atan2(sum_sin / n, sum_cos / n)
    mean_deg = math.degrees(mean_rad)

    # Normalize to 0-360
    if mean_deg < 0:
        mean_deg += 360

    return mean_deg


def generate_aspect_visualization(
    aspect_path: str,
    output_path: str,
    stats: Dict
) -> None:
    """
    Generate color-coded aspect visualization with circular color ramp.

    Color scheme:
        Red: North (0°)
        Yellow: East (90°)
        Green: South (180°)
        Blue: West (270°)
        Back to Red: North (360°)

    Args:
        aspect_path: Path to aspect GeoTIFF
        output_path: Path for output PNG
        stats: Statistics dictionary with dominant direction
    """
    print(f"Generating aspect visualization...")
    aspect_dataset = gdal.Open(aspect_path)
    if not aspect_dataset:
        raise ValueError(f"Failed to open aspect raster: {aspect_path}")

    aspect = aspect_dataset.GetRasterBand(1).ReadAsArray()
    aspect_dataset = None

    # Create figure with aspect plot and legend
    fig, (ax_map, ax_compass) = plt.subplots(
        1, 2,
        figsize=(14, 8),
        gridspec_kw={'width_ratios': [3, 1]}
    )

    # Create custom colormap for circular aspect (0-360°)
    # Use HSV color space: Hue varies with aspect
    from matplotlib.colors import hsv_to_rgb

    aspect_display = np.ma.masked_where(aspect < 0, aspect)

    # Plot aspect map
    im = ax_map.imshow(
        aspect_display,
        cmap='hsv',
        vmin=0,
        vmax=360,
        interpolation='nearest'
    )

    ax_map.set_title(
        f'Aspect (Orientation) Analysis\nDominant Direction: {stats["dominantDirection"]}',
        fontsize=14,
        fontweight='bold'
    )
    ax_map.axis('off')

    # Add colorbar
    cbar = plt.colorbar(im, ax=ax_map, orientation='horizontal', pad=0.05, fraction=0.046)
    cbar.set_label('Aspect (degrees)', fontsize=11)
    cbar.set_ticks([0, 90, 180, 270, 360])
    cbar.set_ticklabels(['N (0°)', 'E (90°)', 'S (180°)', 'W (270°)', 'N (360°)'])

    # Draw compass rose showing distribution
    _draw_compass_rose(ax_compass, stats)

    # Add statistics text
    stats_text = (
        f"North-facing: {stats['northFacingPercent']:.1f}%\n"
        f"South-facing: {stats['southFacingPercent']:.1f}%\n"
        f"Flat areas: {stats['flatPercent']:.1f}%"
    )

    if stats['circularMeanAspect'] is not None:
        stats_text += f"\nMean aspect: {stats['circularMeanAspect']:.1f}°"

    fig.text(
        0.72, 0.15,
        stats_text,
        fontsize=10,
        bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5)
    )

    plt.tight_layout()
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    plt.close()

    print(f"Aspect visualization saved to: {output_path}")


def _draw_compass_rose(ax, stats: Dict):
    """Draw compass rose showing directional distribution."""
    ax.set_xlim(-1.5, 1.5)
    ax.set_ylim(-1.5, 1.5)
    ax.set_aspect('equal')
    ax.axis('off')
    ax.set_title('Directional Distribution', fontsize=12, fontweight='bold')

    # Direction info
    directions = [
        ('N', 0, stats['northPercent'], 'red'),
        ('NE', 45, stats['northeastPercent'], 'orange'),
        ('E', 90, stats['eastPercent'], 'yellow'),
        ('SE', 135, stats['southeastPercent'], 'yellowgreen'),
        ('S', 180, stats['southPercent'], 'green'),
        ('SW', 225, stats['southwestPercent'], 'cyan'),
        ('W', 270, stats['westPercent'], 'blue'),
        ('NW', 315, stats['northwestPercent'], 'purple')
    ]

    # Draw wedges for each direction
    for label, angle, percent, color in directions:
        # Convert to matplotlib angles (0° = East, counter-clockwise)
        theta1 = 90 - (angle + 22.5)
        theta2 = 90 - (angle - 22.5)

        # Scale radius by percentage
        radius = 0.3 + (percent / 100) * 0.7  # Min 0.3, max 1.0

        wedge = Wedge(
            (0, 0),
            radius,
            theta1,
            theta2,
            facecolor=color,
            edgecolor='black',
            linewidth=1,
            alpha=0.7
        )
        ax.add_patch(wedge)

    # Add direction labels
    for label, angle, percent, color in directions:
        # Convert to radians for positioning
        rad = math.radians(angle)
        x = 1.2 * math.sin(rad)
        y = 1.2 * math.cos(rad)

        ax.text(
            x, y, f'{label}\n{percent:.1f}%',
            ha='center',
            va='center',
            fontsize=9,
            fontweight='bold'
        )

    # Add center circle
    circle = plt.Circle((0, 0), 0.2, color='white', zorder=10)
    ax.add_patch(circle)


def identify_facing_areas(
    aspect_path: str,
    north_facing_output: str,
    south_facing_output: str
) -> Tuple[Optional[str], Optional[str]]:
    """
    Identify north-facing and south-facing areas and export as GeoJSON polygons.

    North-facing: 315° - 45° (N, NE, NW)
    South-facing: 135° - 225° (S, SE, SW)

    Args:
        aspect_path: Path to aspect GeoTIFF
        north_facing_output: Path for north-facing GeoJSON
        south_facing_output: Path for south-facing GeoJSON

    Returns:
        Tuple of (north_facing_geojson, south_facing_geojson) as JSON strings
    """
    print("Identifying north-facing and south-facing areas...")

    aspect_dataset = gdal.Open(aspect_path)
    if not aspect_dataset:
        raise ValueError(f"Failed to open aspect raster: {aspect_path}")

    aspect = aspect_dataset.GetRasterBand(1).ReadAsArray()
    geotransform = aspect_dataset.GetGeoTransform()
    projection = aspect_dataset.GetProjection()
    width = aspect_dataset.RasterXSize
    height = aspect_dataset.RasterYSize

    # Create binary masks
    north_facing_mask = np.zeros_like(aspect, dtype=np.uint8)
    south_facing_mask = np.zeros_like(aspect, dtype=np.uint8)

    for y in range(height):
        for x in range(width):
            angle = aspect[y, x]

            if angle < 0:
                continue

            # North-facing: 315° - 45°
            if angle >= 315 or angle < 45:
                north_facing_mask[y, x] = 1

            # South-facing: 135° - 225°
            if 135 <= angle < 225:
                south_facing_mask[y, x] = 1

    # Convert masks to polygons
    north_geojson = _mask_to_geojson(
        north_facing_mask,
        geotransform,
        projection,
        north_facing_output
    )

    south_geojson = _mask_to_geojson(
        south_facing_mask,
        geotransform,
        projection,
        south_facing_output
    )

    aspect_dataset = None

    print("North-facing and south-facing areas identified")

    return north_geojson, south_geojson


def _mask_to_geojson(
    mask: np.ndarray,
    geotransform: tuple,
    projection: str,
    output_path: str
) -> Optional[str]:
    """
    Convert binary mask to GeoJSON polygons using GDAL Polygonize.

    Returns:
        GeoJSON string or None if no features
    """
    from osgeo import gdal, ogr, osr

    # Create temporary in-memory raster
    driver = gdal.GetDriverByName('MEM')
    mem_raster = driver.Create('', mask.shape[1], mask.shape[0], 1, gdal.GDT_Byte)
    mem_raster.SetGeoTransform(geotransform)
    mem_raster.SetProjection(projection)
    mem_band = mem_raster.GetRasterBand(1)
    mem_band.WriteArray(mask)

    # Create in-memory vector layer
    ogr_driver = ogr.GetDriverByName('Memory')
    ogr_dataset = ogr_driver.CreateDataSource('memData')

    srs = osr.SpatialReference()
    srs.ImportFromWkt(projection)

    ogr_layer = ogr_dataset.CreateLayer('polygons', srs, ogr.wkbPolygon)
    ogr_layer.CreateField(ogr.FieldDefn('value', ogr.OFTInteger))

    # Polygonize
    gdal.Polygonize(mem_band, None, ogr_layer, 0, [], callback=None)

    # Convert to GeoJSON
    feature_count = ogr_layer.GetFeatureCount()

    if feature_count == 0:
        mem_raster = None
        ogr_dataset = None
        return None

    # Export to GeoJSON
    geojson_driver = ogr.GetDriverByName('GeoJSON')
    geojson_dataset = geojson_driver.CreateDataSource(output_path)
    geojson_driver.CopyLayer(ogr_dataset, ogr_layer, 'areas')
    geojson_dataset = None

    # Read GeoJSON as string
    with open(output_path, 'r') as f:
        geojson_str = f.read()

    # Clean up
    mem_raster = None
    ogr_dataset = None

    return geojson_str
