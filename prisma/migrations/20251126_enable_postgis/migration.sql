-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyBoundary" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "geometry" geometry(Polygon, 4326) NOT NULL,
    "areaSquareMeters" DOUBLE PRECISION NOT NULL,
    "areaAcres" DOUBLE PRECISION NOT NULL,
    "areaHectares" DOUBLE PRECISION NOT NULL,
    "perimeterMeters" DOUBLE PRECISION NOT NULL,
    "centroidLat" DOUBLE PRECISION NOT NULL,
    "centroidLng" DOUBLE PRECISION NOT NULL,
    "parsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyBoundary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_userId_idx" ON "Project"("userId");

-- CreateIndex
CREATE INDEX "PropertyBoundary_projectId_idx" ON "PropertyBoundary"("projectId");

-- CreateIndex
CREATE INDEX "PropertyBoundary_fileId_idx" ON "PropertyBoundary"("fileId");

-- CreateIndex (Spatial index for PostGIS geometry column)
CREATE INDEX "PropertyBoundary_geometry_idx" ON "PropertyBoundary" USING GIST ("geometry");

-- CreateIndex (Unique constraint on fileId)
CREATE UNIQUE INDEX "PropertyBoundary_fileId_key" ON "PropertyBoundary"("fileId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyBoundary" ADD CONSTRAINT "PropertyBoundary_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyBoundary" ADD CONSTRAINT "PropertyBoundary_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "UploadedFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
