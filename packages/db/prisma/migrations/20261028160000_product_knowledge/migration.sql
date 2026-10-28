-- Product usage, part numbers, and competitor/partner pages for the knowledge base.
ALTER TABLE "Product" ADD COLUMN "usage" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Product" ADD COLUMN "partNumbers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TYPE "MarketRole" AS ENUM ('COMPETITOR', 'PARTNER');

CREATE TABLE "MarketLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "role" "MarketRole" NOT NULL,
    "url" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'website',
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketLink_sourceId_key" ON "MarketLink"("sourceId");
CREATE INDEX "MarketLink_organizationId_idx" ON "MarketLink"("organizationId");
CREATE INDEX "MarketLink_productId_idx" ON "MarketLink"("productId");

ALTER TABLE "MarketLink" ADD CONSTRAINT "MarketLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketLink" ADD CONSTRAINT "MarketLink_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
