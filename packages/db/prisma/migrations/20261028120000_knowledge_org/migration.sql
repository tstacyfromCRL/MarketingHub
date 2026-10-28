-- One default organization, backfilled from the existing brand profile when it has a name.
CREATE TABLE "Organization" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

INSERT INTO "Organization" ("id", "name", "slug", "createdAt")
SELECT
  'org_default',
  COALESCE(NULLIF((SELECT "companyName" FROM "BrandProfile" WHERE id = 'brand'), ''), 'Default'),
  'default',
  CURRENT_TIMESTAMP;

CREATE TYPE "Sensitivity" AS ENUM ('PUBLIC', 'INTERNAL', 'RESTRICTED');

-- The existing brand row keeps id 'brand'. New rows get an application-generated id.
ALTER TABLE "BrandProfile" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "BrandProfile" ADD COLUMN "organizationId" TEXT;
UPDATE "BrandProfile" SET "organizationId" = 'org_default';
ALTER TABLE "BrandProfile" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE UNIQUE INDEX "BrandProfile_organizationId_key" ON "BrandProfile"("organizationId");
ALTER TABLE "BrandProfile" ADD CONSTRAINT "BrandProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Product" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Product" ADD COLUMN "positioning" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Product" ADD COLUMN "packFeatures" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Product" ADD COLUMN "packLinks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Product" ADD COLUMN "sensitivity" "Sensitivity" NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "Product" ADD COLUMN "externalKey" TEXT;
ALTER TABLE "Product" ADD COLUMN "connectorKey" TEXT;
ALTER TABLE "Product" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "Product" ADD COLUMN "contentHash" TEXT;
ALTER TABLE "Product" ADD COLUMN "lastSyncedAt" TIMESTAMP(3);
UPDATE "Product" SET "organizationId" = 'org_default';
ALTER TABLE "Product" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Product" ADD CONSTRAINT "Product_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Product_organizationId_externalKey_key" ON "Product"("organizationId", "externalKey");
CREATE UNIQUE INDEX "Product_organizationId_connectorKey_key" ON "Product"("organizationId", "connectorKey");
CREATE INDEX "Product_organizationId_sku_idx" ON "Product"("organizationId", "sku");

ALTER TABLE "Accomplishment" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Accomplishment" ADD COLUMN "sensitivity" "Sensitivity" NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "Accomplishment" ADD COLUMN "externalKey" TEXT;
ALTER TABLE "Accomplishment" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "Accomplishment" ADD COLUMN "contentHash" TEXT;
UPDATE "Accomplishment" SET "organizationId" = 'org_default';
ALTER TABLE "Accomplishment" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Accomplishment" ADD CONSTRAINT "Accomplishment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Accomplishment_organizationId_externalKey_key" ON "Accomplishment"("organizationId", "externalKey");

ALTER TYPE "SourceKind" ADD VALUE 'DOCUMENT';

ALTER TABLE "Source" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Source" ADD COLUMN "sensitivity" "Sensitivity" NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "Source" ADD COLUMN "externalKey" TEXT;
ALTER TABLE "Source" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "Source" ADD COLUMN "contentHash" TEXT;
UPDATE "Source" SET "organizationId" = 'org_default';
ALTER TABLE "Source" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Source" ADD CONSTRAINT "Source_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Source_organizationId_externalKey_key" ON "Source"("organizationId", "externalKey");
CREATE INDEX "Source_organizationId_kind_idx" ON "Source"("organizationId", "kind");

ALTER TABLE "KnowledgeChunk" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "KnowledgeChunk" ADD COLUMN "sensitivity" "Sensitivity" NOT NULL DEFAULT 'PUBLIC';
UPDATE "KnowledgeChunk" SET "organizationId" = 'org_default';
ALTER TABLE "KnowledgeChunk" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "KnowledgeChunk_organizationId_sourceType_idx" ON "KnowledgeChunk"("organizationId", "sourceType");

CREATE TABLE "PromptTemplate" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "externalKey" TEXT,
  "name" TEXT NOT NULL,
  "platform" TEXT,
  "contentType" TEXT,
  "pillar" TEXT,
  "body" TEXT NOT NULL,
  "hashtagMin" INTEGER,
  "hashtagMax" INTEGER,
  "maxChars" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 1,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "origin" TEXT NOT NULL DEFAULT 'manual',
  "contentHash" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PromptTemplate_organizationId_externalKey_key" ON "PromptTemplate"("organizationId", "externalKey");
CREATE INDEX "PromptTemplate_organizationId_active_idx" ON "PromptTemplate"("organizationId", "active");
ALTER TABLE "PromptTemplate" ADD CONSTRAINT "PromptTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Claim" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "externalKey" TEXT,
  "text" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL DEFAULT '',
  "asOf" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'APPROVED',
  "productIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sensitivity" "Sensitivity" NOT NULL DEFAULT 'PUBLIC',
  "origin" TEXT NOT NULL DEFAULT 'manual',
  "contentHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Claim_organizationId_externalKey_key" ON "Claim"("organizationId", "externalKey");
CREATE INDEX "Claim_organizationId_status_idx" ON "Claim"("organizationId", "status");
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ConfidentialTerm" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "term" TEXT NOT NULL,
  "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "note" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConfidentialTerm_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ConfidentialTerm_organizationId_term_key" ON "ConfidentialTerm"("organizationId", "term");
ALTER TABLE "ConfidentialTerm" ADD CONSTRAINT "ConfidentialTerm_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "IntegrationSetting" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "connectorId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "configEncrypted" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationSetting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IntegrationSetting_organizationId_connectorId_key" ON "IntegrationSetting"("organizationId", "connectorId");
ALTER TABLE "IntegrationSetting" ADD CONSTRAINT "IntegrationSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Campaign" ADD COLUMN "pillar" TEXT;
ALTER TABLE "Post" ADD COLUMN "pillar" TEXT;
ALTER TABLE "Post" ADD COLUMN "aiWarnings" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "PostVariant" ADD COLUMN "aiWarnings" JSONB NOT NULL DEFAULT '[]';
