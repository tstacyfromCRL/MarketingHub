-- Files and folders people can browse but AI must not read or place.
ALTER TABLE "Asset" ADD COLUMN "notForPublicUse" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "LibraryHold" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "relPath" TEXT NOT NULL,
    "kind" "LibraryImportKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryHold_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LibraryHold_libraryId_relPath_key" ON "LibraryHold"("libraryId", "relPath");

ALTER TABLE "LibraryHold" ADD CONSTRAINT "LibraryHold_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library"("id") ON DELETE CASCADE ON UPDATE CASCADE;
