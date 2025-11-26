"""
DEM Generation Lambda Function

Processes contour data from PostGIS and generates Digital Elevation Model (DEM)
using GDAL grid interpolation. Uploads result to S3 and updates job status.

Event payload from SQS:
{
    "jobId": "job_abc123",
    "projectId": "proj_456",
    "propertyBoundaryId": "boundary_789",
    "resolution": 1.0,
    "interpolationMethod": "tin",
    "bounds": {
        "minLat": 37.7,
        "maxLat": 37.8,
        "minLng": -122.5,
        "maxLng": -122.4
    }
}
"""

import json
import os
import traceback
from typing import Dict, Any, List, Tuple
from datetime import datetime

import boto3
import psycopg2
from psycopg2.extras import RealDictCursor

from gdal_operations import (
    create_contour_vrt,
    run_gdal_grid,
    create_geotiff,
    calculate_dem_stats
)
from validation import validate_dem

# Environment variables
DATABASE_URL = os.environ['DATABASE_URL']
S3_BUCKET_NAME = os.environ['S3_BUCKET_NAME']
AWS_REGION = os.environ.get('AWS_REGION', 'us-west-2')

# AWS clients
s3_client = boto3.client('s3', region_name=AWS_REGION)


def handler(event, context):
    """
    Lambda function handler for DEM generation.

    Args:
        event: SQS event with job payload
        context: Lambda context

    Returns:
        dict: Response with statusCode and body
    """
    # Extract message body from SQS event
    if 'Records' in event:
        # SQS batch event
        message_body = event['Records'][0]['body']
        payload = json.loads(message_body)
    else:
        # Direct invocation
        payload = event

    job_id = payload['jobId']
    project_id = payload['projectId']
    property_boundary_id = payload['propertyBoundaryId']
    resolution = payload['resolution']
    interpolation_method = payload['interpolationMethod']
    bounds = payload['bounds']

    print(f"Processing DEM job {job_id} for project {project_id}")
    print(f"Resolution: {resolution}m, Method: {interpolation_method}")

    try:
        # 1. Update job status to 'processing'
        update_job_status(job_id, 'processing', 0)

        # 2. Retrieve contour data from PostGIS
        print("Fetching contour data from PostGIS...")
        contours = fetch_contours_from_postgis(project_id, property_boundary_id)
        print(f"Retrieved {len(contours)} contour lines")
        update_job_status(job_id, 'processing', 20)

        if len(contours) == 0:
            raise ValueError("No contour data found for project")

        # 3. Generate DEM using GDAL
        print("Generating DEM with GDAL...")
        dem_path, width, height = generate_dem(
            contours,
            bounds,
            resolution,
            interpolation_method,
            project_id
        )
        update_job_status(job_id, 'processing', 70)

        # 4. Validate DEM against contours
        print("Validating DEM quality...")
        validation_metrics = validate_dem(dem_path, contours, bounds, resolution)
        print(f"Validation RMSE: {validation_metrics['rmse']:.2f}m")
        update_job_status(job_id, 'processing', 85)

        # Check validation threshold
        if validation_metrics['rmse'] > 2.0:
            raise ValueError(
                f"DEM validation failed: RMSE {validation_metrics['rmse']:.2f}m exceeds threshold"
            )

        # 5. Calculate DEM statistics
        dem_stats = calculate_dem_stats(dem_path)

        # 6. Upload to S3
        print(f"Uploading DEM to S3...")
        s3_path = f"dems/{project_id}/dem_{resolution}m.tif"
        upload_to_s3(dem_path, s3_path)
        update_job_status(job_id, 'processing', 95)

        # 7. Create DigitalElevationModel record
        dem_id = create_dem_record(
            project_id=project_id,
            property_boundary_id=property_boundary_id,
            s3_path=s3_path,
            resolution=resolution,
            width=width,
            height=height,
            interpolation_method=interpolation_method,
            bounds=bounds,
            dem_stats=dem_stats,
            validation_metrics=validation_metrics,
            dem_path=dem_path
        )

        # 8. Update job status to 'completed'
        processing_time = int((datetime.now() - get_job_start_time(job_id)).total_seconds())
        update_job_status(job_id, 'completed', 100, dem_id=dem_id, processing_time=processing_time)

        print(f"DEM generation completed successfully: {dem_id}")

        return {
            "statusCode": 200,
            "body": json.dumps({
                "demId": dem_id,
                "s3Path": s3_path,
                "validation": validation_metrics
            })
        }

    except Exception as e:
        print(f"DEM generation failed: {str(e)}")
        print(traceback.format_exc())

        error_message = f"{type(e).__name__}: {str(e)}"
        update_job_status(job_id, 'failed', 0, error=error_message)

        return {
            "statusCode": 500,
            "body": json.dumps({
                "error": error_message
            })
        }


def fetch_contours_from_postgis(
    project_id: str,
    property_boundary_id: str
) -> List[Dict[str, Any]]:
    """
    Fetch contour lines from PostGIS database.

    Returns list of contours with geometry and elevation.
    """
    conn = psycopg2.connect(DATABASE_URL)
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Query contours with geometry as GeoJSON
        query = """
            SELECT
                id,
                elevation,
                ST_AsGeoJSON(geometry) as geometry_geojson
            FROM "ContourLine"
            WHERE "projectId" = %s
            AND "propertyBoundaryId" = %s
            ORDER BY elevation
        """

        cursor.execute(query, (project_id, property_boundary_id))
        rows = cursor.fetchall()

        contours = []
        for row in rows:
            geometry = json.loads(row['geometry_geojson'])
            contours.append({
                'id': row['id'],
                'elevation': row['elevation'],
                'geometry': geometry
            })

        return contours

    finally:
        cursor.close()
        conn.close()


def generate_dem(
    contours: List[Dict[str, Any]],
    bounds: Dict[str, float],
    resolution: float,
    interpolation_method: str,
    project_id: str
) -> Tuple[str, int, int]:
    """
    Generate DEM from contour data using GDAL.

    Returns:
        Tuple of (dem_path, width, height)
    """
    # Create temporary VRT file with contour data
    vrt_path = f"/tmp/contours_{project_id}.vrt"
    create_contour_vrt(contours, vrt_path)

    # Calculate grid dimensions
    lat_range = bounds['maxLat'] - bounds['minLat']
    lng_range = bounds['maxLng'] - bounds['minLng']

    # Convert to meters (approximate)
    height_m = lat_range * 111320  # 1 degree lat ≈ 111.32km
    width_m = lng_range * 111320 * abs(
        ((bounds['minLat'] + bounds['maxLat']) / 2) * 3.14159 / 180
    )

    width = int(width_m / resolution)
    height = int(height_m / resolution)

    print(f"Grid dimensions: {width} x {height} pixels")

    # Run GDAL grid interpolation
    dem_array = run_gdal_grid(
        vrt_path,
        bounds,
        width,
        height,
        interpolation_method
    )

    # Create GeoTIFF with georeferencing
    dem_path = f"/tmp/dem_{project_id}.tif"
    create_geotiff(dem_array, bounds, resolution, dem_path)

    return dem_path, width, height


def upload_to_s3(local_path: str, s3_key: str) -> None:
    """Upload file to S3."""
    s3_client.upload_file(
        local_path,
        S3_BUCKET_NAME,
        s3_key,
        ExtraArgs={'ContentType': 'image/tiff'}
    )
    print(f"Uploaded to s3://{S3_BUCKET_NAME}/{s3_key}")


def create_dem_record(
    project_id: str,
    property_boundary_id: str,
    s3_path: str,
    resolution: float,
    width: int,
    height: int,
    interpolation_method: str,
    bounds: Dict[str, float],
    dem_stats: Dict[str, float],
    validation_metrics: Dict[str, float],
    dem_path: str
) -> str:
    """Create DigitalElevationModel database record."""
    import os

    file_size = os.path.getsize(dem_path)

    conn = psycopg2.connect(DATABASE_URL)
    cursor = conn.cursor()

    try:
        query = """
            INSERT INTO "DigitalElevationModel" (
                id, "projectId", "propertyBoundaryId", "s3Path", "fileSize",
                resolution, width, height, "interpolationMethod",
                "minLat", "maxLat", "minLng", "maxLng",
                "minElevation", "maxElevation", "avgElevation",
                rmse, "maxDeviation", "contourMatchPercentage"
            )
            VALUES (
                gen_random_uuid(), %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s
            )
            RETURNING id
        """

        cursor.execute(query, (
            project_id, property_boundary_id, s3_path, file_size,
            resolution, width, height, interpolation_method,
            bounds['minLat'], bounds['maxLat'], bounds['minLng'], bounds['maxLng'],
            dem_stats['min'], dem_stats['max'], dem_stats['avg'],
            validation_metrics['rmse'], validation_metrics['maxDeviation'],
            validation_metrics['contourMatchPercentage']
        ))

        dem_id = cursor.fetchone()[0]
        conn.commit()

        return dem_id

    finally:
        cursor.close()
        conn.close()


def update_job_status(
    job_id: str,
    status: str,
    progress: int,
    dem_id: str = None,
    processing_time: int = None,
    error: str = None
) -> None:
    """Update job status in database."""
    conn = psycopg2.connect(DATABASE_URL)
    cursor = conn.cursor()

    try:
        if status == 'processing' and progress == 0:
            # First processing update - set startedAt
            query = """
                UPDATE "DEMProcessingJob"
                SET status = %s, progress = %s, "startedAt" = NOW()
                WHERE id = %s
            """
            cursor.execute(query, (status, progress, job_id))

        elif status == 'completed':
            query = """
                UPDATE "DEMProcessingJob"
                SET status = %s, progress = %s, "demId" = %s,
                    "completedAt" = NOW(), "processingTime" = %s
                WHERE id = %s
            """
            cursor.execute(query, (status, progress, dem_id, processing_time, job_id))

        elif status == 'failed':
            query = """
                UPDATE "DEMProcessingJob"
                SET status = %s, progress = %s, "errorMessage" = %s,
                    "completedAt" = NOW()
                WHERE id = %s
            """
            cursor.execute(query, (status, progress, error, job_id))

        else:
            query = """
                UPDATE "DEMProcessingJob"
                SET status = %s, progress = %s
                WHERE id = %s
            """
            cursor.execute(query, (status, progress, job_id))

        conn.commit()

    finally:
        cursor.close()
        conn.close()


def get_job_start_time(job_id: str) -> datetime:
    """Get job start time from database."""
    conn = psycopg2.connect(DATABASE_URL)
    cursor = conn.cursor()

    try:
        cursor.execute(
            'SELECT "startedAt" FROM "DEMProcessingJob" WHERE id = %s',
            (job_id,)
        )
        result = cursor.fetchone()
        return result[0] if result else datetime.now()

    finally:
        cursor.close()
        conn.close()
