-- AlterEnum
ALTER TYPE "SourceKind" ADD VALUE 'SAMPLE_POST';

-- AlterTable
ALTER TABLE "BrandProfile" ADD COLUMN "summary" TEXT NOT NULL DEFAULT '',
ADD COLUMN "website" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "pricing" TEXT NOT NULL DEFAULT '',
ADD COLUMN "links" TEXT[];

-- AlterTable
ALTER TABLE "Source" ADD COLUMN "productId" TEXT,
ADD COLUMN "platform" TEXT;

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'CREATOR',
    "email" TEXT,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invite_code_key" ON "Invite"("code");

-- CreateIndex
CREATE INDEX "Source_productId_idx" ON "Source"("productId");
