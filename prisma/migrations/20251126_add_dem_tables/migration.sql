-- Story 1.4: Add DEMProcessingJob and DigitalElevationModel tables

-- CreateTable
CREATE TABLE "DEMProcessingJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "propertyBoundaryId" TEXT NOT NULL,
    "contourFileId" TEXT,
    "resolution" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "interpolationMethod" TEXT NOT NULL DEFAULT 'tin',
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "processingTime" INTEGER,
    "demId" TEXT,

    CONSTRAINT "DEMProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigitalElevationModel" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "propertyBoundaryId" TEXT NOT NULL,
    "s3Path" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "resolution" DOUBLE PRECISION NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "interpolationMethod" TEXT NOT NULL,
    "minLat" DOUBLE PRECISION NOT NULL,
    "maxLat" DOUBLE PRECISION NOT NULL,
    "minLng" DOUBLE PRECISION NOT NULL,
    "maxLng" DOUBLE PRECISION NOT NULL,
    "minElevation" DOUBLE PRECISION NOT NULL,
    "maxElevation" DOUBLE PRECISION NOT NULL,
    "avgElevation" DOUBLE PRECISION NOT NULL,
    "rmse" DOUBLE PRECISION NOT NULL,
    "maxDeviation" DOUBLE PRECISION NOT NULL,
    "contourMatchPercentage" DOUBLE PRECISION NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigitalElevationModel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DEMProcessingJob_projectId_idx" ON "DEMProcessingJob"("projectId");

-- CreateIndex
CREATE INDEX "DEMProcessingJob_status_idx" ON "DEMProcessingJob"("status");

-- CreateIndex
CREATE INDEX "DEMProcessingJob_queuedAt_idx" ON "DEMProcessingJob"("queuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DigitalElevationModel_projectId_key" ON "DigitalElevationModel"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "DigitalElevationModel_propertyBoundaryId_key" ON "DigitalElevationModel"("propertyBoundaryId");

-- CreateIndex
CREATE INDEX "DigitalElevationModel_projectId_idx" ON "DigitalElevationModel"("projectId");

-- AddForeignKey
ALTER TABLE "DEMProcessingJob" ADD CONSTRAINT "DEMProcessingJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DEMProcessingJob" ADD CONSTRAINT "DEMProcessingJob_propertyBoundaryId_fkey" FOREIGN KEY ("propertyBoundaryId") REFERENCES "PropertyBoundary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DEMProcessingJob" ADD CONSTRAINT "DEMProcessingJob_demId_fkey" FOREIGN KEY ("demId") REFERENCES "DigitalElevationModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalElevationModel" ADD CONSTRAINT "DigitalElevationModel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalElevationModel" ADD CONSTRAINT "DigitalElevationModel_propertyBoundaryId_fkey" FOREIGN KEY ("propertyBoundaryId") REFERENCES "PropertyBoundary"("id") ON DELETE CASCADE ON UPDATE CASCADE;
