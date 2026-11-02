-- A team Canva connection, and the Canva design id stored on a graphic.

ALTER TABLE "Design" ADD COLUMN "canvaDesignId" TEXT;

CREATE UNIQUE INDEX "Design_canvaDesignId_key" ON "Design"("canvaDesignId");

CREATE TABLE "CanvaAccount" (
    "id" TEXT NOT NULL,
    "canvaUserId" TEXT NOT NULL,
    "teamId" TEXT,
    "displayName" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "connectedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvaAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CanvaAccount_canvaUserId_key" ON "CanvaAccount"("canvaUserId");

ALTER TABLE "CanvaAccount" ADD CONSTRAINT "CanvaAccount_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
