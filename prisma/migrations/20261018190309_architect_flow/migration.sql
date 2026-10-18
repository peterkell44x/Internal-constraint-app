-- Architect diagnosis (version 2). Adds columns only; existing rows keep
-- version 1 and their data is untouched.
ALTER TABLE "Diagnostic" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Diagnostic" ADD COLUMN "flow" JSONB;
ALTER TABLE "Diagnostic" ADD COLUMN "crisis" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Diagnostic" ADD COLUMN "reportJson" JSONB;
