-- Thumbs and notes on generated copy, so later drafts can follow what the team liked.
CREATE TABLE "VoiceFeedback" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VoiceFeedback_organizationId_createdAt_idx" ON "VoiceFeedback"("organizationId", "createdAt");

ALTER TABLE "VoiceFeedback" ADD CONSTRAINT "VoiceFeedback_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoiceFeedback" ADD CONSTRAINT "VoiceFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
