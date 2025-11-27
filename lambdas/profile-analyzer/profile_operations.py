"""
Elevation Profile and Grade Analysis Operations

Generates elevation profiles along user-defined lines with grade calculation,
excessive grade detection, and elevation gain/loss statistics.

Story 2.3: Elevation Profile and Grade Analysis
"""

import numpy as np
import json
import csv
import math
from osgeo import gdal
from typing import List, Dict, Tuple
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


class ProfilePoint:
    """Represents a single point along an elevation profile."""
    def __init__(self, distance: float, elevation: float, lat: float, lng: float, grade: float = 0.0):
        self.distance = distance
        self.elevation = elevation
        self.lat = lat
        self.lng = lng
        self.grade = grade


def haversine_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Calculate distance in meters between two lat/lng points using Haversine formula."""
    R = 6371000  # Earth's radius in meters

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lng2 - lng1)

    a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

    return R * c


def interpolate_point_on_line(coords: List[List[float]], distance_along: float, total_distance: float) -> Tuple[float, float]:
    """
    Interpolate a point at a specific distance along a LineString.

    Args:
        coords: LineString coordinates [[lng, lat], ...]
        distance_along: Distance from start in meters
        total_distance: Total line length in meters

    Returns:
        Tuple of (lng, lat)
    """
    cumulative_distance = 0.0

    for i in range(len(coords) - 1):
        lng1, lat1 = coords[i]
        lng2, lat2 = coords[i + 1]

        segment_distance = haversine_distance(lat1, lng1, lat2, lng2)

        if cumulative_distance + segment_distance >= distance_along:
            # Point is on this segment
            remaining = distance_along - cumulative_distance
            fraction = remaining / segment_distance if segment_distance > 0 else 0

            lng = lng1 + (lng2 - lng1) * fraction
            lat = lat1 + (lat2 - lat1) * fraction

            return lng, lat

        cumulative_distance += segment_distance

    # Return last point if distance_along exceeds total
    return coords[-1]


def calculate_line_length(coords: List[List[float]]) -> float:
    """Calculate total length of a LineString in meters."""
    total = 0.0
    for i in range(len(coords) - 1):
        lng1, lat1 = coords[i]
        lng2, lat2 = coords[i + 1]
        total += haversine_distance(lat1, lng1, lat2, lng2)
    return total


def geo_to_pixel(lng: float, lat: float, geotransform: Tuple) -> Tuple[float, float]:
    """Convert geographic coordinates to pixel coordinates."""
    pixel_x = (lng - geotransform[0]) / geotransform[1]
    pixel_y = (lat - geotransform[3]) / geotransform[5]
    return pixel_x, pixel_y


def bilinear_interpolation(data: np.ndarray, x: float, y: float, nodata: float) -> float:
    """
    Bilinear interpolation for sub-pixel DEM sampling.

    Args:
        data: 2D array of elevation data
        x, y: Pixel coordinates (can be fractional)
        nodata: NoData value to handle

    Returns:
        Interpolated elevation value
    """
    height, width = data.shape

    # Get integer pixel coordinates
    x0 = int(math.floor(x))
    x1 = x0 + 1
    y0 = int(math.floor(y))
    y1 = y0 + 1

    # Boundary checks
    if x0 < 0 or x1 >= width or y0 < 0 or y1 >= height:
        raise ValueError(f"Point ({x}, {y}) is outside DEM bounds")

    # Get four surrounding values
    z00 = data[y0, x0]
    z10 = data[y0, x1]
    z01 = data[y1, x0]
    z11 = data[y1, x1]

    # Check for NoData
    if z00 == nodata or z10 == nodata or z01 == nodata or z11 == nodata:
        # Fallback to nearest neighbor
        return data[int(round(y)), int(round(x))]

    # Fractional offsets
    dx = x - x0
    dy = y - y0

    # Bilinear interpolation
    z0 = z00 * (1 - dx) + z10 * dx
    z1 = z01 * (1 - dx) + z11 * dx
    z = z0 * (1 - dy) + z1 * dy

    return z


def sample_dem_along_line(
    dem_path: str,
    line_coords: List[List[float]],
    sample_interval: float = 5.0
) -> List[ProfilePoint]:
    """
    Sample DEM elevations along a LineString geometry.

    Args:
        dem_path: Path to DEM GeoTIFF
        line_coords: LineString coordinates [[lng, lat], ...]
        sample_interval: Meters between sample points

    Returns:
        List of ProfilePoint objects
    """
    print(f"Loading DEM from: {dem_path}")
    dataset = gdal.Open(dem_path)
    if not dataset:
        raise ValueError(f"Failed to open DEM: {dem_path}")

    band = dataset.GetRasterBand(1)
    geotransform = dataset.GetGeoTransform()
    nodata = band.GetNoDataValue()

    # Read entire DEM into memory for faster sampling
    data = band.ReadAsArray()

    # Calculate total line length
    total_distance = calculate_line_length(line_coords)
    num_samples = int(math.ceil(total_distance / sample_interval)) + 1

    print(f"Line length: {total_distance:.1f}m, Samples: {num_samples}")

    profile_points = []

    for i in range(num_samples):
        distance_from_start = min(i * sample_interval, total_distance)

        # Interpolate point along line
        lng, lat = interpolate_point_on_line(line_coords, distance_from_start, total_distance)

        # Convert to pixel coordinates
        pixel_x, pixel_y = geo_to_pixel(lng, lat, geotransform)

        try:
            # Bilinear interpolation
            elevation = bilinear_interpolation(data, pixel_x, pixel_y, nodata or -9999)

            profile_points.append(
                ProfilePoint(
                    distance=distance_from_start,
                    elevation=elevation,
                    lat=lat,
                    lng=lng
                )
            )
        except ValueError as e:
            print(f"Warning: Skipping point at distance {distance_from_start}m: {e}")

    dataset = None

    print(f"Sampled {len(profile_points)} points")
    return profile_points


def calculate_grades(profile_points: List[ProfilePoint]) -> List[ProfilePoint]:
    """Calculate grade percentage between consecutive profile points."""
    for i in range(1, len(profile_points)):
        prev = profile_points[i - 1]
        curr = profile_points[i]

        horizontal_distance = curr.distance - prev.distance
        elevation_change = curr.elevation - prev.elevation

        if horizontal_distance > 0:
            # Grade percentage = (rise / run) * 100
            grade = (elevation_change / horizontal_distance) * 100
            curr.grade = grade
        else:
            curr.grade = 0.0

    # First point has no grade
    profile_points[0].grade = 0.0

    return profile_points


def calculate_profile_statistics(
    profile_points: List[ProfilePoint],
    max_grade_threshold: float = 8.0
) -> Dict:
    """
    Calculate comprehensive profile statistics.

    Returns:
        Dictionary with elevation gain/loss, max grades, excessive grade metrics
    """
    elevations = [p.elevation for p in profile_points]

    elevation_gain = 0.0
    elevation_loss = 0.0
    max_grade_uphill = 0.0
    max_grade_downhill = 0.0
    excessive_grade_distance = 0.0
    excessive_segments = []

    for i in range(1, len(profile_points)):
        prev = profile_points[i - 1]
        curr = profile_points[i]

        elevation_change = curr.elevation - prev.elevation
        segment_distance = curr.distance - prev.distance
        grade = curr.grade

        # Accumulate gain/loss
        if elevation_change > 0:
            elevation_gain += elevation_change
        else:
            elevation_loss += abs(elevation_change)

        # Track maximum grades
        if grade > max_grade_uphill:
            max_grade_uphill = grade
        if grade < max_grade_downhill:
            max_grade_downhill = grade

        # Track excessive grade sections
        if abs(grade) > max_grade_threshold:
            excessive_grade_distance += segment_distance
            excessive_segments.append({
                'start': prev.distance,
                'end': curr.distance,
                'grade': round(grade, 1)
            })

    total_distance = profile_points[-1].distance

    return {
        'totalDistance': total_distance,
        'elevationGain': elevation_gain,
        'elevationLoss': elevation_loss,
        'netElevationChange': profile_points[-1].elevation - profile_points[0].elevation,
        'startElevation': profile_points[0].elevation,
        'endElevation': profile_points[-1].elevation,
        'minElevation': min(elevations),
        'maxElevation': max(elevations),
        'maxGradeUphill': max_grade_uphill,
        'maxGradeDownhill': abs(max_grade_downhill),
        'excessiveGradeDistance': excessive_grade_distance,
        'excessiveGradePercent': (excessive_grade_distance / total_distance) * 100 if total_distance > 0 else 0,
        'excessiveSegments': excessive_segments
    }


def export_profile_csv(profile_points: List[ProfilePoint], output_path: str):
    """Export profile data to CSV format."""
    print(f"Exporting CSV to: {output_path}")

    with open(output_path, 'w', newline='') as csvfile:
        writer = csv.writer(csvfile)
        writer.writerow(['distance_m', 'elevation_m', 'grade_percent', 'latitude', 'longitude'])

        for point in profile_points:
            writer.writerow([
                round(point.distance, 2),
                round(point.elevation, 2),
                round(point.grade, 2),
                round(point.lat, 6),
                round(point.lng, 6)
            ])

    print(f"CSV exported with {len(profile_points)} points")


def generate_profile_chart(
    profile_points: List[ProfilePoint],
    stats: Dict,
    max_grade_threshold: float,
    output_path: str,
    profile_name: str = "Elevation Profile"
):
    """Generate professional elevation profile chart as PNG."""
    print(f"Generating profile chart...")

    distances = [p.distance for p in profile_points]
    elevations = [p.elevation for p in profile_points]
    grades = [p.grade for p in profile_points]

    # Create figure
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 8), height_ratios=[3, 1])

    # Plot 1: Elevation profile
    ax1.plot(distances, elevations, linewidth=2, color='#2E86AB', label='Elevation')
    ax1.fill_between(distances, elevations, alpha=0.3, color='#2E86AB')

    # Highlight excessive grade sections
    for segment in stats.get('excessiveSegments', []):
        start_idx = next((i for i, p in enumerate(profile_points) if p.distance >= segment['start']), 0)
        end_idx = next((i for i, p in enumerate(profile_points) if p.distance >= segment['end']), len(profile_points)-1)

        if start_idx < end_idx:
            ax1.axvspan(
                distances[start_idx],
                distances[end_idx],
                alpha=0.2,
                color='red',
                label='Excessive Grade' if start_idx == 0 else ''
            )

    ax1.set_ylabel('Elevation (m)', fontsize=12)
    ax1.set_title(f'{profile_name}\nDistance: {stats["totalDistance"]:.0f}m | Gain: {stats["elevationGain"]:.1f}m | Loss: {stats["elevationLoss"]:.1f}m',
                  fontsize=14, fontweight='bold')
    ax1.grid(True, alpha=0.3)
    ax1.legend(loc='best')

    # Plot 2: Grade profile
    colors = ['red' if abs(g) > max_grade_threshold else 'green' for g in grades]
    ax2.bar(distances, grades, width=(distances[1] - distances[0]) if len(distances) > 1 else 1,
            color=colors, alpha=0.6)
    ax2.axhline(y=max_grade_threshold, color='red', linestyle='--', linewidth=1, label=f'Max Grade ({max_grade_threshold}%)')
    ax2.axhline(y=-max_grade_threshold, color='red', linestyle='--', linewidth=1)
    ax2.axhline(y=0, color='black', linestyle='-', linewidth=0.5)

    ax2.set_xlabel('Distance (m)', fontsize=12)
    ax2.set_ylabel('Grade (%)', fontsize=12)
    ax2.set_title('Grade Profile', fontsize=12, fontweight='bold')
    ax2.grid(True, alpha=0.3)
    ax2.legend(loc='best')

    # Add statistics text
    stats_text = (
        f"Max Uphill: {stats['maxGradeUphill']:.1f}%\n"
        f"Max Downhill: {stats['maxGradeDownhill']:.1f}%\n"
        f"Excessive: {stats['excessiveGradePercent']:.1f}% of route"
    )

    fig.text(0.15, 0.02, stats_text, fontsize=10, bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))

    plt.tight_layout()
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    plt.close()

    print(f"Chart saved to: {output_path}")


def export_profile_json(profile_points: List[ProfilePoint], stats: Dict, output_path: str):
    """Export profile data as JSON for interactive charts."""
    data = {
        'points': [
            {
                'distance': p.distance,
                'elevation': p.elevation,
                'grade': p.grade,
                'lat': p.lat,
                'lng': p.lng
            }
            for p in profile_points
        ],
        'statistics': stats
    }

    with open(output_path, 'w') as f:
        json.dump(data, f, indent=2)

    print(f"JSON exported to: {output_path}")
