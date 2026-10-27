-- CreateEnum
CREATE TYPE "LibraryImportKind" AS ENUM ('FOLDER', 'FILE');

-- CreateTable
CREATE TABLE "LibraryImport" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "relPath" TEXT NOT NULL,
    "kind" "LibraryImportKind" NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LibraryImport_libraryId_relPath_key" ON "LibraryImport"("libraryId", "relPath");

-- AddForeignKey
ALTER TABLE "LibraryImport" ADD CONSTRAINT "LibraryImport_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library"("id") ON DELETE CASCADE ON UPDATE CASCADE;
