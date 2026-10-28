-- Pack imports must be able to prune only the terms they created.
ALTER TABLE "ConfidentialTerm" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'manual';
