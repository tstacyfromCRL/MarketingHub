-- Folders and product tags for graphics in the content studio.
-- Removing a folder clears the graphic's folder, and the graphic itself stays.

CREATE TABLE "DesignFolder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignFolder_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Design" ADD COLUMN "folderId" TEXT;

CREATE INDEX "Design_folderId_idx" ON "Design"("folderId");

ALTER TABLE "Design" ADD CONSTRAINT "Design_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "DesignFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "DesignProduct" (
    "designId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "DesignProduct_pkey" PRIMARY KEY ("designId","productId")
);

CREATE INDEX "DesignProduct_productId_idx" ON "DesignProduct"("productId");

ALTER TABLE "DesignProduct" ADD CONSTRAINT "DesignProduct_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DesignProduct" ADD CONSTRAINT "DesignProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
