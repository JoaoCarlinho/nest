"""
Slope Calculation Lambda Function

Calculates slope percentage and classification from DEM (Digital Elevation Model).
Generates slope raster, classified raster, heatmap visualization, and statistics.

Event payload from SQS:
{
    "projectId": "proj_456",
    "demId": "dem_789",
    "propertyBoundaryId": "boundary_123",
    "smoothingEnabled": false,
    "smoothingKernelSize": 3,
    "maxBuildableSlope": 15.0,
    "flatThreshold": 5.0,
    "moderateThreshold": 15.0,
    "steepThreshold": 25.0
}
"""

import json
import os
import traceback
from typing import Dict, Any, Tuple
from datetime import datetime

import boto3
import psycopg2
from psycopg2.extras import RealDictCursor

from slope_operations import (
    calculate_slope,
    classify_slope,
    calculate_slope_statistics,
    generate_heatmap,
    identify_unbuildable_areas
)

# Environment variables
DATABASE_URL = os.environ['DATABASE_URL']
S3_BUCKET_NAME = os.environ['S3_BUCKET_NAME']
AWS_REGION = os.environ.get('AWS_REGION', 'us-west-2')

# AWS clients
s3_client = boto3.client('s3', region_name=AWS_REGION)


def handler(event, context):
    """
    Lambda function handler for slope calculation.

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

    project_id = payload['projectId']
    dem_id = payload['demId']
    property_boundary_id = payload['propertyBoundaryId']
    smoothing_enabled = payload.get('smoothingEnabled', False)
    smoothing_kernel_size = payload.get('smoothingKernelSize', 3)
    max_buildable_slope = payload.get('maxBuildableSlope', 15.0)

    thresholds = {
        'flat': payload.get('flatThreshold', 5.0),
        'moderate': payload.get('moderateThreshold', 15.0),
        'steep': payload.get('steepThreshold', 25.0)
    }

    print(f"Processing slope calculation for project {project_id}")
    print(f"DEM ID: {dem_id}, Smoothing: {smoothing_enabled}")

    start_time = datetime.now()

    try:
        # 1. Retrieve DEM metadata from database
        print("Fetching DEM metadata from database...")
        dem_metadata = fetch_dem_metadata(dem_id)

        if not dem_metadata:
            raise ValueError(f"DEM not found: {dem_id}")

        # 2. Download DEM from S3
        print(f"Downloading DEM from S3: {dem_metadata['s3Path']}")
        dem_local_path = f"/tmp/dem_{project_id}.tif"
        download_from_s3(dem_metadata['s3Path'], dem_local_path)

        # 3. Calculate slope
        print("Calculating slope from DEM...")
        slope_path = f"/tmp/slope_{project_id}.tif"
        calculate_slope(
            dem_local_path,
            slope_path,
            smoothing_enabled,
            smoothing_kernel_size
        )

        # 4. Classify slope
        print("Classifying slope into categories...")
        classified_path = f"/tmp/slope_classified_{project_id}.tif"
        classify_slope(slope_path, classified_path, thresholds)

        # 5. Calculate statistics
        print("Calculating slope statistics...")
        stats = calculate_slope_statistics(slope_path, thresholds, max_buildable_slope)
        print(f"Slope stats: mean={stats['meanSlope']:.2f}%, max={stats['maxSlope']:.2f}%")

        # 6. Generate heatmap visualization
        print("Generating slope heatmap...")
        heatmap_path = f"/tmp/slope_heatmap_{project_id}.png"
        generate_heatmap(
            classified_path,
            heatmap_path,
            dem_metadata,
            thresholds,
            stats
        )

        # 7. Identify unbuildable areas
        print("Identifying unbuildable areas...")
        unbuildable_geojson = identify_unbuildable_areas(
            slope_path,
            max_buildable_slope,
            dem_metadata
        )

        # 8. Upload files to S3
        print("Uploading results to S3...")
        slope_s3_path = f"slope-analysis/{project_id}/slope.tif"
        classified_s3_path = f"slope-analysis/{project_id}/slope_classified.tif"
        heatmap_s3_path = f"slope-analysis/{project_id}/slope_heatmap.png"
        unbuildable_s3_path = f"slope-analysis/{project_id}/unbuildable_areas.geojson"

        upload_to_s3(slope_path, slope_s3_path, 'image/tiff')
        upload_to_s3(classified_path, classified_s3_path, 'image/tiff')
        upload_to_s3(heatmap_path, heatmap_s3_path, 'image/png')

        # Upload GeoJSON as JSON
        if unbuildable_geojson:
            unbuildable_path = f"/tmp/unbuildable_{project_id}.geojson"
            with open(unbuildable_path, 'w') as f:
                json.dump(unbuildable_geojson, f)
            upload_to_s3(unbuildable_path, unbuildable_s3_path, 'application/geo+json')

        # 9. Create SlopeAnalysis database record
        processing_time = int((datetime.now() - start_time).total_seconds() * 1000)

        slope_analysis_id = create_slope_analysis_record(
            project_id=project_id,
            property_boundary_id=property_boundary_id,
            dem_id=dem_id,
            smoothing_enabled=smoothing_enabled,
            smoothing_kernel_size=smoothing_kernel_size if smoothing_enabled else None,
            max_buildable_slope=max_buildable_slope,
            thresholds=thresholds,
            stats=stats,
            slope_s3_path=slope_s3_path,
            classified_s3_path=classified_s3_path,
            heatmap_s3_path=heatmap_s3_path,
            unbuildable_s3_path=unbuildable_s3_path if unbuildable_geojson else None,
            processing_time_ms=processing_time
        )

        print(f"Slope analysis completed successfully: {slope_analysis_id}")

        return {
            "statusCode": 200,
            "body": json.dumps({
                "slopeAnalysisId": slope_analysis_id,
                "statistics": stats,
                "processingTimeMs": processing_time
            })
        }

    except Exception as e:
        print(f"Slope calculation failed: {str(e)}")
        print(traceback.format_exc())

        error_message = f"{type(e).__name__}: {str(e)}"

        return {
            "statusCode": 500,
            "body": json.dumps({
                "error": error_message
            })
        }


def fetch_dem_metadata(dem_id: str) -> Dict[str, Any]:
    """Fetch DEM metadata from database."""
    conn = psycopg2.connect(DATABASE_URL)
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    try:
        query = """
            SELECT *
            FROM "DigitalElevationModel"
            WHERE id = %s
        """
        cursor.execute(query, (dem_id,))
        result = cursor.fetchone()

        return dict(result) if result else None

    finally:
        cursor.close()
        conn.close()


def download_from_s3(s3_key: str, local_path: str) -> None:
    """Download file from S3 to local path."""
    s3_client.download_file(S3_BUCKET_NAME, s3_key, local_path)
    print(f"Downloaded s3://{S3_BUCKET_NAME}/{s3_key} to {local_path}")


def upload_to_s3(local_path: str, s3_key: str, content_type: str) -> None:
    """Upload file to S3."""
    s3_client.upload_file(
        local_path,
        S3_BUCKET_NAME,
        s3_key,
        ExtraArgs={'ContentType': content_type}
    )
    print(f"Uploaded to s3://{S3_BUCKET_NAME}/{s3_key}")


def create_slope_analysis_record(
    project_id: str,
    property_boundary_id: str,
    dem_id: str,
    smoothing_enabled: bool,
    smoothing_kernel_size: int,
    max_buildable_slope: float,
    thresholds: Dict[str, float],
    stats: Dict[str, float],
    slope_s3_path: str,
    classified_s3_path: str,
    heatmap_s3_path: str,
    unbuildable_s3_path: str,
    processing_time_ms: int
) -> str:
    """Create SlopeAnalysis database record."""
    conn = psycopg2.connect(DATABASE_URL)
    cursor = conn.cursor()

    try:
        query = """
            INSERT INTO "SlopeAnalysis" (
                id, "projectId", "propertyBoundaryId", "demId",
                "smoothingEnabled", "smoothingKernelSize", "maxBuildableSlope",
                "flatThreshold", "moderateThreshold", "steepThreshold",
                "meanSlope", "medianSlope", "maxSlope",
                "flatPercent", "moderatePercent", "steepPercent", "verySteepPercent",
                "unbuildablePercent",
                "slopeGeoTiffPath", "classifiedGeoTiffPath", "heatmapPngPath",
                "unbuildableAreasGeoJson", "processingTimeMs"
            )
            VALUES (
                gen_random_uuid(), %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s, %s,
                %s,
                %s, %s, %s,
                %s, %s
            )
            RETURNING id
        """

        cursor.execute(query, (
            project_id, property_boundary_id, dem_id,
            smoothing_enabled, smoothing_kernel_size, max_buildable_slope,
            thresholds['flat'], thresholds['moderate'], thresholds['steep'],
            stats['meanSlope'], stats['medianSlope'], stats['maxSlope'],
            stats['flatPercent'], stats['moderatePercent'], stats['steepPercent'],
            stats['verySteepPercent'], stats['unbuildablePercent'],
            slope_s3_path, classified_s3_path, heatmap_s3_path,
            unbuildable_s3_path, processing_time_ms
        ))

        slope_analysis_id = cursor.fetchone()[0]
        conn.commit()

        return slope_analysis_id

    finally:
        cursor.close()
        conn.close()
