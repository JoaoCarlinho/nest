# DEM Generator Lambda Function

AWS Lambda function for generating Digital Elevation Models (DEMs) from contour data using GDAL.

## Overview

This Lambda function processes contour line data from PostGIS and generates a georeferenced GeoTIFF DEM using GDAL grid interpolation. The function is triggered by SQS messages from the Next.js API.

## Architecture

```
Next.js API → SQS Queue → Lambda (Python + GDAL) → S3 + PostgreSQL
```

## Components

- `lambda_function.py` - Main Lambda handler
- `gdal_operations.py` - GDAL grid interpolation and GeoTIFF creation
- `validation.py` - DEM quality validation against contours
- `requirements.txt` - Python dependencies
- `Dockerfile` - Container image definition

## Requirements

- AWS Lambda with container image support
- Python 3.11
- GDAL 3.6+
- PostgreSQL access (RDS)
- S3 bucket for DEM storage
- SQS queue for job messages

## Environment Variables

The Lambda function requires these environment variables:

```bash
DATABASE_URL=postgresql://user:password@rds-endpoint:5432/nest
S3_BUCKET_NAME=nest-uploads-production
AWS_REGION=us-west-2
```

## Local Development

### Prerequisites

```bash
# Install GDAL
# macOS
brew install gdal

# Ubuntu
sudo apt-get install gdal-bin python3-gdal

# Python dependencies
pip install -r requirements.txt
```

### Testing Locally

```python
# Test DEM generation with sample data
import json
from lambda_function import handler

event = {
    "jobId": "test-job-123",
    "projectId": "test-project",
    "propertyBoundaryId": "test-boundary",
    "resolution": 1.0,
    "interpolationMethod": "tin",
    "bounds": {
        "minLat": 37.7,
        "maxLat": 37.8,
        "minLng": -122.5,
        "maxLng": -122.4
    }
}

result = handler(event, {})
print(json.dumps(result, indent=2))
```

## Deployment

### Option 1: Container Image (Recommended)

#### Build Container

```bash
cd lambdas/dem-generator

# Build image
docker build -t dem-generator:latest .

# Test locally
docker run --rm \
  -e DATABASE_URL="postgresql://..." \
  -e S3_BUCKET_NAME="nest-uploads" \
  -e AWS_REGION="us-west-2" \
  dem-generator:latest
```

#### Push to ECR

```bash
# Authenticate to ECR
aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-west-2.amazonaws.com

# Create ECR repository (first time only)
aws ecr create-repository --repository-name nest/dem-generator --region us-west-2

# Tag image
docker tag dem-generator:latest \
  <account-id>.dkr.ecr.us-west-2.amazonaws.com/nest/dem-generator:latest

# Push to ECR
docker push <account-id>.dkr.ecr.us-west-2.amazonaws.com/nest/dem-generator:latest
```

#### Create Lambda Function

```bash
aws lambda create-function \
  --function-name nest-dem-generator \
  --package-type Image \
  --code ImageUri=<account-id>.dkr.ecr.us-west-2.amazonaws.com/nest/dem-generator:latest \
  --role arn:aws:iam::<account-id>:role/lambda-dem-generator-role \
  --timeout 900 \
  --memory-size 3008 \
  --environment Variables="{DATABASE_URL=postgresql://...,S3_BUCKET_NAME=nest-uploads,AWS_REGION=us-west-2}"
```

### Option 2: Terraform (Infrastructure as Code)

Create `infrastructure/terraform/lambda-dem-generator.tf`:

```hcl
# ECR Repository
resource "aws_ecr_repository" "dem_generator" {
  name = "nest/dem-generator"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

# IAM Role for Lambda
resource "aws_iam_role" "dem_generator_lambda" {
  name = "nest-dem-generator-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

# IAM Policy for Lambda
resource "aws_iam_role_policy" "dem_generator_lambda" {
  name = "nest-dem-generator-lambda-policy"
  role = aws_iam_role.dem_generator_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:PutObjectAcl"
        ]
        Resource = "${aws_s3_bucket.uploads.arn}/dems/*"
      },
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
        ]
        Resource = aws_sqs_queue.dem_processing.arn
      }
    ]
  })
}

# Lambda Function
resource "aws_lambda_function" "dem_generator" {
  function_name = "nest-dem-generator"
  role          = aws_iam_role.dem_generator_lambda.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.dem_generator.repository_url}:latest"
  timeout       = 900  # 15 minutes
  memory_size   = 3008 # 3GB

  environment {
    variables = {
      DATABASE_URL    = var.database_url
      S3_BUCKET_NAME  = aws_s3_bucket.uploads.id
      AWS_REGION      = var.aws_region
    }
  }

  # VPC configuration for database access
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.lambda_dem.id]
  }
}

# SQS Trigger
resource "aws_lambda_event_source_mapping" "dem_sqs_trigger" {
  event_source_arn = aws_sqs_queue.dem_processing.arn
  function_name    = aws_lambda_function.dem_generator.arn
  batch_size       = 1
}
```

Deploy with Terraform:

```bash
cd infrastructure/terraform
terraform init
terraform plan
terraform apply
```

## Performance Tuning

### Memory Allocation

- **1GB**: Small sites (<10 acres), 5m resolution
- **2GB**: Medium sites (10-50 acres), 2m resolution
- **3GB**: Large sites (>50 acres), 1m resolution

### Timeout

- **5 minutes**: Most typical sites
- **10 minutes**: Large sites or complex terrain
- **15 minutes**: Maximum Lambda timeout

### Optimization Tips

1. Use TIN interpolation for fastest results
2. Lower resolution (2m or 5m) for large sites
3. Ensure contour data is properly clipped to boundary
4. Monitor CloudWatch metrics for optimization opportunities

## Monitoring

### CloudWatch Metrics

- Lambda duration
- Memory usage
- Error rates
- SQS queue depth

### CloudWatch Logs

Logs include:
- Job ID and project ID
- Contour count
- Grid dimensions
- Validation metrics
- Processing time
- Errors with stack traces

### Alerts

Recommended CloudWatch Alarms:
- Lambda errors > 5% (5 minutes)
- Lambda duration > 10 minutes
- SQS queue depth > 10 messages

## Troubleshooting

### Common Issues

**1. GDAL Import Error**
```
ModuleNotFoundError: No module named 'osgeo'
```
Solution: Ensure GDAL is installed in container image

**2. Database Connection Error**
```
psycopg2.OperationalError: could not connect to server
```
Solution: Check VPC configuration and security groups

**3. S3 Upload Permission Denied**
```
botocore.exceptions.ClientError: Access Denied
```
Solution: Verify IAM role has S3 PutObject permission

**4. Validation Failure**
```
ValueError: DEM validation failed: RMSE 3.5m exceeds threshold
```
Solution: Check contour data quality or try different interpolation method

## Testing

### Unit Tests

```bash
# Run Python unit tests
pytest tests/test_gdal_operations.py
pytest tests/test_validation.py
```

### Integration Test

```bash
# Invoke Lambda with test event
aws lambda invoke \
  --function-name nest-dem-generator \
  --payload file://test-event.json \
  response.json

cat response.json
```

## Cost Estimation

Based on AWS pricing (us-west-2, as of 2024):

- Lambda: $0.0000166667 per GB-second
- S3 storage: $0.023 per GB/month
- SQS: $0.40 per million requests

Example costs:
- Small DEM (1m, 10 acres): ~$0.02 per generation
- Medium DEM (2m, 50 acres): ~$0.05 per generation
- Large DEM (5m, 200 acres): ~$0.10 per generation

## Security Considerations

1. **Database Credentials**: Store in AWS Secrets Manager
2. **S3 Access**: Use least-privilege IAM policies
3. **VPC**: Run Lambda in private subnets
4. **Encryption**: Enable S3 encryption at rest
5. **Logging**: Enable CloudWatch Logs encryption

## License

See project root LICENSE file.
