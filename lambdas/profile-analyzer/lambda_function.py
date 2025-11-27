"""
AWS Lambda function for Elevation Profile and Grade Analysis

Triggered by SQS queue messages from POST /api/terrain/profile/create
Generates elevation profiles along user-defined lines with grade analysis.

Story 2.3: Elevation Profile and Grade Analysis
"""

import json
import os
import time
import boto3
import psycopg2
from profile_operations import (
    sample_dem_along_line,
    calculate_grades,
    calculate_profile_statistics,
    export_profile_csv,
    generate_profile_chart,
    export_profile_json
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
    Lambda handler for elevation profile generation.

    Expected SQS message body:
    {
        "profileId": "profile_123",
        "projectId": "proj_456",
        "lineCoordinates": [[lng, lat], ...],
        "name": "Route A",
        "sampleInterval": 5.0,
        "maxGradeThreshold": 8.0,
        "userId": "user_789"
    }
    """
    print(f"Received event: {json.dumps(event)}")

    start_time = time.time()

    # Parse SQS message
    for record in event['Records']:
        try:
            body = json.loads(record['body'])
            profile_id = body['profileId']
            project_id = body['projectId']
            line_coords = body['lineCoordinates']
            profile_name = body.get('name', 'Elevation Profile')
            sample_interval = body.get('sampleInterval', 5.0)
            max_grade_threshold = body.get('maxGradeThreshold', 8.0)
            user_id = body['userId']
            description = body.get('description')

            print(f"Processing profile: {profile_id} for project: {project_id}")

            # Process profile generation
            process_profile_generation(
                profile_id,
                project_id,
                line_coords,
                profile_name,
                sample_interval,
                max_grade_threshold,
                user_id,
                description,
                start_time
            )

        except Exception as e:
            print(f"Error processing profile generation: {str(e)}")
            raise e

    return {
        'statusCode': 200,
        'body': json.dumps({'message': 'Profile generation complete'})
    }


def process_profile_generation(
    profile_id: str,
    project_id: str,
    line_coords: list,
    profile_name: str,
    sample_interval: float,
    max_grade_threshold: float,
    user_id: str,
    description: str,
    start_time: float
):
    """Execute complete elevation profile generation workflow."""

    # Step 1: Fetch DEM metadata
    print("Step 1: Fetching DEM metadata...")
    dem_metadata = fetch_dem_metadata(project_id)
    dem_id = dem_metadata['id']
    property_boundary_id = dem_metadata['property_boundary_id']
    dem_s3_path = dem_metadata['s3_path']

    # Step 2: Download DEM from S3
    print("Step 2: Downloading DEM from S3...")
    dem_local_path = f'/tmp/dem-{project_id}.tif'
    download_from_s3(dem_s3_path, dem_local_path)

    # Step 3: Sample DEM along line
    print("Step 3: Sampling DEM along profile line...")
    profile_points = sample_dem_along_line(
        dem_path=dem_local_path,
        line_coords=line_coords,
        sample_interval=sample_interval
    )

    # Step 4: Calculate grades
    print("Step 4: Calculating grades...")
    profile_points = calculate_grades(profile_points)

    # Step 5: Calculate statistics
    print("Step 5: Calculating profile statistics...")
    stats = calculate_profile_statistics(profile_points, max_grade_threshold)

    # Step 6: Export CSV
    print("Step 6: Exporting CSV...")
    csv_local_path = f'/tmp/profile-{profile_id}.csv'
    export_profile_csv(profile_points, csv_local_path)

    # Step 7: Generate chart PNG
    print("Step 7: Generating profile chart...")
    png_local_path = f'/tmp/profile-{profile_id}.png'
    generate_profile_chart(
        profile_points,
        stats,
        max_grade_threshold,
        png_local_path,
        profile_name
    )

    # Step 8: Export JSON (optional)
    print("Step 8: Exporting JSON...")
    json_local_path = f'/tmp/profile-{profile_id}.json'
    export_profile_json(profile_points, stats, json_local_path)

    # Step 9: Upload results to S3
    print("Step 9: Uploading results to S3...")
    csv_s3_path = f'projects/{project_id}/profiles/{profile_id}/data.csv'
    png_s3_path = f'projects/{project_id}/profiles/{profile_id}/chart.png'
    json_s3_path = f'projects/{project_id}/profiles/{profile_id}/data.json'

    upload_to_s3(csv_local_path, csv_s3_path)
    upload_to_s3(png_local_path, png_s3_path)
    upload_to_s3(json_local_path, json_s3_path)

    # Step 10: Save profile record to database
    print("Step 10: Saving profile to database...")
    processing_time_ms = int((time.time() - start_time) * 1000)

    create_profile_record(
        profile_id=profile_id,
        project_id=project_id,
        property_boundary_id=property_boundary_id,
        dem_id=dem_id,
        user_id=user_id,
        name=profile_name,
        description=description,
        line_coords=line_coords,
        sample_interval=sample_interval,
        sample_count=len(profile_points),
        max_grade_threshold=max_grade_threshold,
        stats=stats,
        csv_s3_path=csv_s3_path,
        png_s3_path=png_s3_path,
        json_s3_path=json_s3_path,
        processing_time_ms=processing_time_ms
    )

    print(f"Profile generation complete for {profile_id} in {processing_time_ms}ms")


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


def download_from_s3(s3_path: str, local_path: str):
    """Download file from S3."""
    print(f"Downloading s3://{S3_BUCKET}/{s3_path} to {local_path}")
    s3_client.download_file(S3_BUCKET, s3_path, local_path)


def upload_to_s3(local_path: str, s3_path: str):
    """Upload file to S3."""
    print(f"Uploading {local_path} to s3://{S3_BUCKET}/{s3_path}")
    s3_client.upload_file(local_path, S3_BUCKET, s3_path)


def create_profile_record(
    profile_id: str,
    project_id: str,
    property_boundary_id: str,
    dem_id: str,
    user_id: str,
    name: str,
    description: str,
    line_coords: list,
    sample_interval: float,
    sample_count: int,
    max_grade_threshold: float,
    stats: dict,
    csv_s3_path: str,
    png_s3_path: str,
    json_s3_path: str,
    processing_time_ms: int
):
    """Create ElevationProfile database record."""
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD
    )
    cursor = conn.cursor()

    # Convert line coords to WKT LineString
    coords_wkt = ', '.join([f'{lng} {lat}' for lng, lat in line_coords])
    line_wkt = f'SRID=4326;LINESTRING({coords_wkt})'

    # Start and end points
    start_wkt = f'SRID=4326;POINT({line_coords[0][0]} {line_coords[0][1]})'
    end_wkt = f'SRID=4326;POINT({line_coords[-1][0]} {line_coords[-1][1]})'

    cursor.execute("""
        INSERT INTO "ElevationProfile" (
            id,
            "projectId",
            "propertyBoundaryId",
            "demId",
            "createdBy",
            name,
            description,
            "lineGeometry",
            "startPoint",
            "endPoint",
            "sampleInterval",
            "sampleCount",
            "totalDistance",
            "elevationGain",
            "elevationLoss",
            "netElevationChange",
            "startElevation",
            "endElevation",
            "minElevation",
            "maxElevation",
            "maxGradeThreshold",
            "maxGradeUphill",
            "maxGradeDownhill",
            "excessiveGradeDistance",
            "excessiveGradePercent",
            "profileDataCsv",
            "profileChartPng",
            "profileDataJson",
            "processingTimeMs",
            "createdAt"
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s,
            ST_GeomFromText(%s),
            ST_GeomFromText(%s),
            ST_GeomFromText(%s),
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW()
        )
    """, (
        profile_id,
        project_id,
        property_boundary_id,
        dem_id,
        user_id,
        name,
        description,
        line_wkt,
        start_wkt,
        end_wkt,
        sample_interval,
        sample_count,
        stats['totalDistance'],
        stats['elevationGain'],
        stats['elevationLoss'],
        stats['netElevationChange'],
        stats['startElevation'],
        stats['endElevation'],
        stats['minElevation'],
        stats['maxElevation'],
        max_grade_threshold,
        stats['maxGradeUphill'],
        stats['maxGradeDownhill'],
        stats['excessiveGradeDistance'],
        stats['excessiveGradePercent'],
        csv_s3_path,
        png_s3_path,
        json_s3_path,
        processing_time_ms
    ))

    conn.commit()
    cursor.close()
    conn.close()

    print(f"ElevationProfile record created: {profile_id}")
