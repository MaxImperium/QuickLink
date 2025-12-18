-- =============================================================================
-- PostgreSQL Initialization Script
-- =============================================================================
--
-- This script runs when the Docker container is first created.
-- It sets up extensions and initial configuration.
--
-- For the full schema, see:
--   packages/db/prisma/migrations/001_initial_schema/migration.sql
--
-- In production, use Prisma migrations:
--   npx prisma migrate deploy
--
-- =============================================================================

-- Enable useful extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";      -- UUID generation
CREATE EXTENSION IF NOT EXISTS "pg_trgm";        -- Trigram fuzzy search
CREATE EXTENSION IF NOT EXISTS "btree_gist";     -- GiST index support

-- Grant permissions (adjust as needed for your setup)
GRANT ALL PRIVILEGES ON DATABASE quicklink TO quicklink;

-- Set timezone to UTC for consistency
SET timezone = 'UTC';

-- =============================================================================
-- Quick Schema Setup (for development)
-- =============================================================================
-- Uncomment the line below to run the full migration on init:
-- \i /docker-entrypoint-initdb.d/001_initial_schema.sql
-- =============================================================================
