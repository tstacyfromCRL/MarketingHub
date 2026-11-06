-- Keyword searches, the pages they find, and projects those pages can be filed under.
-- A hit is not knowledge until someone files it, which creates a Source.

CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ArticleSearch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "keywords" TEXT NOT NULL,
    "intervalDays" INTEGER,
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleSearch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ArticleHit" (
    "id" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "snippet" TEXT NOT NULL DEFAULT '',
    "sourceId" TEXT,
    "foundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleHit_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Source" ADD COLUMN "projectId" TEXT;

CREATE INDEX "Project_organizationId_idx" ON "Project"("organizationId");
CREATE INDEX "ArticleSearch_organizationId_idx" ON "ArticleSearch"("organizationId");
CREATE UNIQUE INDEX "ArticleHit_searchId_url_key" ON "ArticleHit"("searchId", "url");
CREATE INDEX "ArticleHit_sourceId_idx" ON "ArticleHit"("sourceId");
CREATE INDEX "Source_projectId_idx" ON "Source"("projectId");

ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArticleSearch" ADD CONSTRAINT "ArticleSearch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArticleHit" ADD CONSTRAINT "ArticleHit_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "ArticleSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArticleHit" ADD CONSTRAINT "ArticleHit_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Source" ADD CONSTRAINT "Source_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
