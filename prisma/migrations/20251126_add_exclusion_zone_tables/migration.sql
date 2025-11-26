-- CreateEnum for exclusion zone types
CREATE TYPE "ExclusionZoneType" AS ENUM ('WETLAND', 'PROTECTED_AREA', 'EASEMENT', 'BUFFER', 'SETBACK', 'CUSTOM');

-- Story 1.5: ExclusionZone table for wetlands, protected areas, easements
CREATE TABLE "ExclusionZone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "propertyBoundaryId" TEXT NOT NULL,
    "fileId" TEXT,
    "createdBy" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ExclusionZoneType" NOT NULL,
    "description" TEXT,
    "geometry" geometry(Polygon, 4326) NOT NULL,
    "bufferDistance" DOUBLE PRECISION,
    "bufferedGeometry" geometry(Polygon, 4326),
    "attributes" JSONB,
    "areaSquareMeters" DOUBLE PRECISION NOT NULL,
    "areaAcres" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExclusionZone_pkey" PRIMARY KEY ("id")
);

-- Story 1.5: BuildableArea table for calculated buildable regions
CREATE TABLE "BuildableArea" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "propertyBoundaryId" TEXT NOT NULL,
    "geometry" geometry(MultiPolygon, 4326) NOT NULL,
    "areaSquareMeters" DOUBLE PRECISION NOT NULL,
    "areaAcres" DOUBLE PRECISION NOT NULL,
    "areaHectares" DOUBLE PRECISION NOT NULL,
    "totalPropertyArea" DOUBLE PRECISION NOT NULL,
    "excludedArea" DOUBLE PRECISION NOT NULL,
    "buildablePercent" DOUBLE PRECISION NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exclusionCount" INTEGER NOT NULL,

    CONSTRAINT "BuildableArea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for ExclusionZone
CREATE INDEX "ExclusionZone_projectId_idx" ON "ExclusionZone"("projectId");
CREATE INDEX "ExclusionZone_propertyBoundaryId_idx" ON "ExclusionZone"("propertyBoundaryId");
CREATE INDEX "ExclusionZone_type_idx" ON "ExclusionZone"("type");
CREATE INDEX "ExclusionZone_createdBy_idx" ON "ExclusionZone"("createdBy");

-- PostGIS spatial indexes for ExclusionZone geometries
CREATE INDEX "ExclusionZone_geometry_idx" ON "ExclusionZone" USING GIST ("geometry");
CREATE INDEX "ExclusionZone_bufferedGeometry_idx" ON "ExclusionZone" USING GIST ("bufferedGeometry");

-- CreateIndex for BuildableArea
CREATE INDEX "BuildableArea_projectId_idx" ON "BuildableArea"("projectId");

-- PostGIS spatial index for BuildableArea
CREATE INDEX "BuildableArea_geometry_idx" ON "BuildableArea" USING GIST ("geometry");

-- Add unique constraints
CREATE UNIQUE INDEX "BuildableArea_projectId_key" ON "BuildableArea"("projectId");
CREATE UNIQUE INDEX "BuildableArea_propertyBoundaryId_key" ON "BuildableArea"("propertyBoundaryId");

-- AddForeignKey constraints
ALTER TABLE "ExclusionZone" ADD CONSTRAINT "ExclusionZone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExclusionZone" ADD CONSTRAINT "ExclusionZone_propertyBoundaryId_fkey" FOREIGN KEY ("propertyBoundaryId") REFERENCES "PropertyBoundary"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExclusionZone" ADD CONSTRAINT "ExclusionZone_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "UploadedFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExclusionZone" ADD CONSTRAINT "ExclusionZone_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BuildableArea" ADD CONSTRAINT "BuildableArea_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuildableArea" ADD CONSTRAINT "BuildableArea_propertyBoundaryId_fkey" FOREIGN KEY ("propertyBoundaryId") REFERENCES "PropertyBoundary"("id") ON DELETE CASCADE ON UPDATE CASCADE;
