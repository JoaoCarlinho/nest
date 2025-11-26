# Dockerfile for Slope Calculator Lambda Function
# Builds container with Python 3.11 + GDAL + Matplotlib for AWS Lambda

FROM public.ecr.aws/lambda/python:3.11

# Install GDAL and dependencies
RUN yum update -y && \
    yum install -y \
    gcc \
    gcc-c++ \
    make \
    gdal \
    gdal-devel \
    postgresql-devel \
    freetype \
    freetype-devel \
    libpng-devel \
    && yum clean all

# Set GDAL environment variables
ENV GDAL_DATA=/usr/share/gdal
ENV PROJ_LIB=/usr/share/proj

# Copy requirements and install Python dependencies
COPY requirements.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

# Copy Lambda function code
COPY lambda_function.py ${LAMBDA_TASK_ROOT}/
COPY slope_operations.py ${LAMBDA_TASK_ROOT}/

# Set Lambda handler
CMD ["lambda_function.handler"]
