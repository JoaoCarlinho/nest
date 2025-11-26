"""
AWS Lambda function for Aspect (Orientation) Analysis

Triggered by SQS queue messages from POST /api/terrain/aspect/calculate
Calculates terrain aspect (compass direction) from DEM and slope data.

Story 2.2: Aspect (Orientation) Analysis
"""

import json
import os
import time
import boto3
import psycopg2
from urllib.parse import urlparse
from aspect_operations import (
    calculate_aspect,
    classify_aspect,
    calculate_aspect_statistics,
    generate_aspect_visualization,
    identify_facing_areas
)


# AWS clients
s3_client = boto3.client('s3')

# Database connection
DB_HOST = os.environ['DB_HOST']
DB_PORT = os.environ.get('DB_PORT', '5432')
DB_NAME = os.environ['DB_NAME']
DB_USER = os.environ['DB_USER']
DB_PASSWORD = os.environ['DB_PASSWORD']

# S3 bucket
S3_BUCKET = os.environ['S3_BUCKET']


def handler(event, context):
    """
    Lambda handler for aspect calculation.

    Expected SQS message body:
    {
        "projectId": "proj_123",
        "flatAreaThreshold": 2.0
    }
    """
    print(f"Received event: {json.dumps(event)}")

    start_time = time.time()

    # Parse SQS message
    for record in event['Records']:
        try:
            body = json.loads(record['body'])
            project_id = body['projectId']
            flat_threshold = body.get('flatAreaThreshold', 2.0)

            print(f"Processing aspect calculation for project: {project_id}")

            # Process aspect calculation
            process_aspect_calculation(project_id, flat_threshold, start_time)

        except Exception as e:
            print(f"Error processing aspect calculation: {str(e)}")
            raise e

    return {
        'statusCode': 200,
        'body': json.dumps({'message': 'Aspect calculation complete'})
    }


def process_aspect_calculation(project_id: str, flat_threshold: float, start_time: float):
    """Execute complete aspect calculation workflow."""

    # Step 1: Fetch DEM and slope analysis metadata from database
    print("Step 1: Fetching DEM and slope analysis metadata...")
    dem_metadata = fetch_dem_metadata(project_id)
    slope_metadata = fetch_slope_metadata(project_id)

    dem_id = dem_metadata['id']
    slope_analysis_id = slope_metadata['id']
    property_boundary_id = dem_metadata['property_boundary_id']
    dem_s3_path = dem_metadata['s3_path']
    slope_s3_path = slope_metadata['slope_geotiff_path']

    # Step 2: Download DEM and slope rasters from S3
    print("Step 2: Downloading DEM and slope rasters from S3...")
    dem_local_path = f'/tmp/dem-{project_id}.tif'
    slope_local_path = f'/tmp/slope-{project_id}.tif'

    download_from_s3(dem_s3_path, dem_local_path)
    download_from_s3(slope_s3_path, slope_local_path)

    # Step 3: Calculate aspect (0-360 degrees)
    print("Step 3: Calculating aspect...")
    aspect_local_path = f'/tmp/aspect-{project_id}.tif'

    calculate_aspect(
        dem_path=dem_local_path,
        slope_path=slope_local_path,
        output_path=aspect_local_path,
        flat_threshold=flat_threshold
    )

    # Step 4: Classify aspect into 8 cardinal directions
    print("Step 4: Classifying aspect into 8 directions...")
    classified_local_path = f'/tmp/aspect-classified-{project_id}.tif'

    classify_aspect(
        aspect_path=aspect_local_path,
        output_path=classified_local_path
    )

    # Step 5: Calculate aspect statistics
    print("Step 5: Calculating aspect statistics...")
    stats = calculate_aspect_statistics(aspect_local_path)

    # Step 6: Generate aspect visualization
    print("Step 6: Generating aspect visualization...")
    visualization_local_path = f'/tmp/aspect-viz-{project_id}.png'

    generate_aspect_visualization(
        aspect_path=aspect_local_path,
        output_path=visualization_local_path,
        stats=stats
    )

    # Step 7: Identify north-facing and south-facing areas
    print("Step 7: Identifying north-facing and south-facing areas...")
    north_facing_local = f'/tmp/north-facing-{project_id}.geojson'
    south_facing_local = f'/tmp/south-facing-{project_id}.geojson'

    north_geojson, south_geojson = identify_facing_areas(
        aspect_path=aspect_local_path,
        north_facing_output=north_facing_local,
        south_facing_output=south_facing_local
    )

    # Step 8: Upload results to S3
    print("Step 8: Uploading results to S3...")
    aspect_s3_path = f'projects/{project_id}/terrain/aspect/aspect-{project_id}.tif'
    classified_s3_path = f'projects/{project_id}/terrain/aspect/aspect-classified-{project_id}.tif'
    visualization_s3_path = f'projects/{project_id}/terrain/aspect/aspect-viz-{project_id}.png'
    north_facing_s3_path = f'projects/{project_id}/terrain/aspect/north-facing-{project_id}.geojson'
    south_facing_s3_path = f'projects/{project_id}/terrain/aspect/south-facing-{project_id}.geojson'

    upload_to_s3(aspect_local_path, aspect_s3_path)
    upload_to_s3(classified_local_path, classified_s3_path)
    upload_to_s3(visualization_local_path, visualization_s3_path)

    if north_geojson:
        upload_to_s3(north_facing_local, north_facing_s3_path)
    if south_geojson:
        upload_to_s3(south_facing_local, south_facing_s3_path)

    # Step 9: Save aspect analysis record to database
    print("Step 9: Saving aspect analysis to database...")
    processing_time_ms = int((time.time() - start_time) * 1000)

    create_aspect_analysis_record(
        project_id=project_id,
        property_boundary_id=property_boundary_id,
        dem_id=dem_id,
        slope_analysis_id=slope_analysis_id,
        flat_threshold=flat_threshold,
        stats=stats,
        aspect_s3_path=aspect_s3_path,
        classified_s3_path=classified_s3_path,
        visualization_s3_path=visualization_s3_path,
        north_facing_geojson=north_geojson,
        south_facing_geojson=south_geojson,
        processing_time_ms=processing_time_ms
    )

    print(f"Aspect calculation complete for project {project_id} in {processing_time_ms}ms")


def fetch_dem_metadata(project_id: str) -> dict:
    """Fetch DEM metadata from database."""
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD
    )
    cursor = conn.cursor()

    cursor.execute("""
        SELECT id, "propertyBoundaryId", "s3Path"
        FROM "DigitalElevationModel"
        WHERE "projectId" = %s
    """, (project_id,))

    row = cursor.fetchone()
    cursor.close()
    conn.close()

    if not row:
        raise ValueError(f"DEM not found for project: {project_id}")

    return {
        'id': row[0],
        'property_boundary_id': row[1],
        's3_path': row[2]
    }


def fetch_slope_metadata(project_id: str) -> dict:
    """Fetch slope analysis metadata from database."""
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD
    )
    cursor = conn.cursor()

    cursor.execute("""
        SELECT id, "slopeGeoTiffPath"
        FROM "SlopeAnalysis"
        WHERE "projectId" = %s
    """, (project_id,))

    row = cursor.fetchone()
    cursor.close()
    conn.close()

    if not row:
        raise ValueError(f"Slope analysis not found for project: {project_id}. Run Story 2.1 first.")

    return {
        'id': row[0],
        'slope_geotiff_path': row[1]
    }


def download_from_s3(s3_path: str, local_path: str):
    """Download file from S3."""
    print(f"Downloading s3://{S3_BUCKET}/{s3_path} to {local_path}")
    s3_client.download_file(S3_BUCKET, s3_path, local_path)


def upload_to_s3(local_path: str, s3_path: str):
    """Upload file to S3."""
    print(f"Uploading {local_path} to s3://{S3_BUCKET}/{s3_path}")
    s3_client.upload_file(local_path, S3_BUCKET, s3_path)


def create_aspect_analysis_record(
    project_id: str,
    property_boundary_id: str,
    dem_id: str,
    slope_analysis_id: str,
    flat_threshold: float,
    stats: dict,
    aspect_s3_path: str,
    classified_s3_path: str,
    visualization_s3_path: str,
    north_facing_geojson: str,
    south_facing_geojson: str,
    processing_time_ms: int
):
    """Create AspectAnalysis database record."""
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD
    )
    cursor = conn.cursor()

    cursor.execute("""
        INSERT INTO "AspectAnalysis" (
            id,
            "projectId",
            "propertyBoundaryId",
            "demId",
            "slopeAnalysisId",
            "flatAreaThreshold",
            "flatPercent",
            "northPercent",
            "northeastPercent",
            "eastPercent",
            "southeastPercent",
            "southPercent",
            "southwestPercent",
            "westPercent",
            "northwestPercent",
            "dominantDirection",
            "circularMeanAspect",
            "northFacingPercent",
            "southFacingPercent",
            "aspectGeoTiffPath",
            "classifiedGeoTiffPath",
            "visualizationPngPath",
            "northFacingAreasGeojson",
            "southFacingAreasGeojson",
            "processingTimeMs",
            "calculatedAt"
        ) VALUES (
            gen_random_uuid(),
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, NOW()
        )
        ON CONFLICT ("projectId") DO UPDATE SET
            "flatAreaThreshold" = EXCLUDED."flatAreaThreshold",
            "flatPercent" = EXCLUDED."flatPercent",
            "northPercent" = EXCLUDED."northPercent",
            "northeastPercent" = EXCLUDED."northeastPercent",
            "eastPercent" = EXCLUDED."eastPercent",
            "southeastPercent" = EXCLUDED."southeastPercent",
            "southPercent" = EXCLUDED."southPercent",
            "southwestPercent" = EXCLUDED."southwestPercent",
            "westPercent" = EXCLUDED."westPercent",
            "northwestPercent" = EXCLUDED."northwestPercent",
            "dominantDirection" = EXCLUDED."dominantDirection",
            "circularMeanAspect" = EXCLUDED."circularMeanAspect",
            "northFacingPercent" = EXCLUDED."northFacingPercent",
            "southFacingPercent" = EXCLUDED."southFacingPercent",
            "aspectGeoTiffPath" = EXCLUDED."aspectGeoTiffPath",
            "classifiedGeoTiffPath" = EXCLUDED."classifiedGeoTiffPath",
            "visualizationPngPath" = EXCLUDED."visualizationPngPath",
            "northFacingAreasGeojson" = EXCLUDED."northFacingAreasGeojson",
            "southFacingAreasGeojson" = EXCLUDED."southFacingAreasGeojson",
            "processingTimeMs" = EXCLUDED."processingTimeMs",
            "calculatedAt" = NOW()
    """, (
        project_id,
        property_boundary_id,
        dem_id,
        slope_analysis_id,
        flat_threshold,
        stats['flatPercent'],
        stats['northPercent'],
        stats['northeastPercent'],
        stats['eastPercent'],
        stats['southeastPercent'],
        stats['southPercent'],
        stats['southwestPercent'],
        stats['westPercent'],
        stats['northwestPercent'],
        stats['dominantDirection'],
        stats['circularMeanAspect'],
        stats['northFacingPercent'],
        stats['southFacingPercent'],
        aspect_s3_path,
        classified_s3_path,
        visualization_s3_path,
        north_facing_geojson,
        south_facing_geojson,
        processing_time_ms
    ))

    conn.commit()
    cursor.close()
    conn.close()

    print(f"AspectAnalysis record created for project: {project_id}")
