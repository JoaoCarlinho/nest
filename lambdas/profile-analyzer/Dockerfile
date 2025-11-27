# Lambda container for elevation profile and grade analysis
# Story 2.3: Elevation Profile and Grade Analysis

FROM public.ecr.aws/lambda/python:3.11

# Install GDAL and dependencies
RUN yum install -y \
    gdal \
    gdal-devel \
    freetype \
    freetype-devel \
    && yum clean all

# Copy requirements and install Python dependencies
COPY requirements.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r requirements.txt

# Copy Lambda function code
COPY lambda_function.py ${LAMBDA_TASK_ROOT}/
COPY profile_operations.py ${LAMBDA_TASK_ROOT}/

# Set the CMD to your handler
CMD ["lambda_function.handler"]
