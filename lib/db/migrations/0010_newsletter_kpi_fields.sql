-- Add structured KPI fields to newsletter_editions
-- Run: psql "$DATABASE_URL" -f lib/db/migrations/0010_newsletter_kpi_fields.sql

ALTER TABLE newsletter_editions ADD COLUMN IF NOT EXISTS kpi_tiles    JSONB;
ALTER TABLE newsletter_editions ADD COLUMN IF NOT EXISTS cause_effect JSONB;
ALTER TABLE newsletter_editions ADD COLUMN IF NOT EXISTS checklist    JSONB;
