-- Story 1.3: Add ContourLine and TerrainMetadata tables

-- CreateTable
CREATE TABLE "ContourLine" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "propertyBoundaryId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "geometry" geometry(LineString, 4326) NOT NULL,
    "elevation" DOUBLE PRECISION NOT NULL,
    "elevationUnit" TEXT NOT NULL DEFAULT 'meters',
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContourLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerrainMetadata" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "propertyBoundaryId" TEXT NOT NULL,
    "minElevation" DOUBLE PRECISION NOT NULL,
    "maxElevation" DOUBLE PRECISION NOT NULL,
    "avgElevation" DOUBLE PRECISION NOT NULL,
    "elevationRange" DOUBLE PRECISION NOT NULL,
    "contourCount" INTEGER NOT NULL,
    "contourInterval" DOUBLE PRECISION,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TerrainMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContourLine_projectId_idx" ON "ContourLine"("projectId");

-- CreateIndex
CREATE INDEX "ContourLine_propertyBoundaryId_idx" ON "ContourLine"("propertyBoundaryId");

-- CreateIndex
CREATE INDEX "ContourLine_fileId_idx" ON "ContourLine"("fileId");

-- CreateIndex
CREATE INDEX "ContourLine_elevation_idx" ON "ContourLine"("elevation");

-- CreateIndex (Spatial index for PostGIS geometry column)
CREATE INDEX "ContourLine_geometry_idx" ON "ContourLine" USING GIST ("geometry");

-- CreateIndex
CREATE UNIQUE INDEX "TerrainMetadata_projectId_key" ON "TerrainMetadata"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "TerrainMetadata_propertyBoundaryId_key" ON "TerrainMetadata"("propertyBoundaryId");

-- CreateIndex
CREATE INDEX "TerrainMetadata_projectId_idx" ON "TerrainMetadata"("projectId");

-- AddForeignKey
ALTER TABLE "ContourLine" ADD CONSTRAINT "ContourLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContourLine" ADD CONSTRAINT "ContourLine_propertyBoundaryId_fkey" FOREIGN KEY ("propertyBoundaryId") REFERENCES "PropertyBoundary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContourLine" ADD CONSTRAINT "ContourLine_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "UploadedFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerrainMetadata" ADD CONSTRAINT "TerrainMetadata_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerrainMetadata" ADD CONSTRAINT "TerrainMetadata_propertyBoundaryId_fkey" FOREIGN KEY ("propertyBoundaryId") REFERENCES "PropertyBoundary"("id") ON DELETE CASCADE ON UPDATE CASCADE;
