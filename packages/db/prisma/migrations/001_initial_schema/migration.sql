-- =============================================================================
-- QuickLink Database Schema - Initial Migration
-- =============================================================================
--
-- Migration: 001_initial_schema
-- Created:   2024-12-18
-- Purpose:   Create all core tables for URL shortener
--
-- Tables:
--   1. users              - User accounts (future auth)
--   2. links              - Core URL shortening table
--   3. click_events       - Individual click tracking
--   4. aggregated_stats   - Pre-computed daily statistics
--   5. reserved_aliases   - Blocklist management
--
-- Design Decisions:
--   - BIGINT for IDs: Supports billions of rows without overflow
--   - Separate click_events and aggregated_stats: 
--     Raw events for detailed analysis, aggregated for fast dashboards
--   - Soft delete via deleted_at: Preserve data for audit/recovery
--   - Composite indexes on hot paths: short_code lookup, link+time queries
--
-- Performance Considerations:
--   - click_events will be highest volume (millions/day at scale)
--   - Consider partitioning click_events by created_at at >100M rows
--   - short_code index is critical - every redirect hits this
--
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For fuzzy search if needed

-- =============================================================================
-- ENUMS
-- =============================================================================

-- Link lifecycle states
-- Used to manage link availability separate from soft delete
DO $$ BEGIN
    CREATE TYPE link_lifecycle_state AS ENUM (
        'active',    -- Link is active and accepting redirects
        'expired',   -- Link has passed its expiration date
        'disabled'   -- Link manually disabled by owner/admin
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE link_lifecycle_state IS 'Link lifecycle states for managing availability';

-- =============================================================================
-- TABLE: users
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
    id          BIGSERIAL PRIMARY KEY,
    email       VARCHAR(255) NOT NULL UNIQUE,
    name        VARCHAR(100),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE users IS 'User accounts for link ownership and authentication';
COMMENT ON COLUMN users.id IS 'Auto-incrementing primary key';
COMMENT ON COLUMN users.email IS 'Unique email address for login';
COMMENT ON COLUMN users.name IS 'Display name (optional)';

-- =============================================================================
-- TABLE: links
-- =============================================================================

CREATE TABLE IF NOT EXISTS links (
    id              BIGSERIAL PRIMARY KEY,
    
    -- Core fields
    short_code      VARCHAR(10) NOT NULL UNIQUE,
    target_url      TEXT NOT NULL,
    title           VARCHAR(255),
    
    -- Lifecycle management
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    custom_alias    BOOLEAN NOT NULL DEFAULT FALSE,
    lifecycle_state link_lifecycle_state NOT NULL DEFAULT 'active',
    expires_at      TIMESTAMPTZ,
    
    -- Soft delete
    deleted_at      TIMESTAMPTZ,
    
    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Foreign keys
    user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL
);

-- Comments
COMMENT ON TABLE links IS 'Core link entity - main table for URL shortening';
COMMENT ON COLUMN links.short_code IS 'Unique short code (e.g., "aB3xY9k"), max 10 chars';
COMMENT ON COLUMN links.target_url IS 'Destination URL to redirect to';
COMMENT ON COLUMN links.active IS 'Whether link accepts redirects';
COMMENT ON COLUMN links.custom_alias IS 'True if user-provided alias, false if auto-generated';
COMMENT ON COLUMN links.lifecycle_state IS 'State machine: active, expired, disabled';
COMMENT ON COLUMN links.deleted_at IS 'Soft delete timestamp (null = not deleted)';

-- Indexes
-- Primary lookup - CRITICAL for redirect performance
CREATE INDEX IF NOT EXISTS idx_links_short_code ON links(short_code);

-- User dashboard queries
CREATE INDEX IF NOT EXISTS idx_links_user_id ON links(user_id);

-- Filtering active links
CREATE INDEX IF NOT EXISTS idx_links_active_state ON links(active, lifecycle_state);

-- Soft delete filtering
CREATE INDEX IF NOT EXISTS idx_links_deleted_at ON links(deleted_at);

-- Combined index for redirect queries (active, not deleted, valid state)
CREATE INDEX IF NOT EXISTS idx_links_redirect_lookup 
    ON links(short_code, active, lifecycle_state, deleted_at);

-- =============================================================================
-- TABLE: click_events
-- =============================================================================

CREATE TABLE IF NOT EXISTS click_events (
    id          BIGSERIAL PRIMARY KEY,
    link_id     BIGINT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Request metadata
    ip_address  VARCHAR(45),        -- IPv4 or IPv6
    user_agent  TEXT,
    referrer    TEXT,
    
    -- Geo data (populated by background job)
    region      VARCHAR(50),
    country     VARCHAR(2),         -- ISO 3166-1 alpha-2
    
    -- Bot detection
    bot         BOOLEAN NOT NULL DEFAULT FALSE
);

-- Comments
COMMENT ON TABLE click_events IS 'Individual click events for detailed analytics (high volume)';
COMMENT ON COLUMN click_events.ip_address IS 'Client IP - consider hashing for GDPR';
COMMENT ON COLUMN click_events.user_agent IS 'Full UA string for device/browser detection';
COMMENT ON COLUMN click_events.referrer IS 'HTTP Referer header';
COMMENT ON COLUMN click_events.region IS 'Geographic region from IP lookup';
COMMENT ON COLUMN click_events.country IS 'ISO 3166-1 alpha-2 country code';
COMMENT ON COLUMN click_events.bot IS 'Whether click appears to be from a bot';

-- Indexes
-- Link-specific analytics
CREATE INDEX IF NOT EXISTS idx_click_events_link_id ON click_events(link_id);

-- Time-range queries
CREATE INDEX IF NOT EXISTS idx_click_events_created_at ON click_events(created_at);

-- Combined index - most common query pattern
CREATE INDEX IF NOT EXISTS idx_click_events_link_time ON click_events(link_id, created_at);

-- Bot filtering
CREATE INDEX IF NOT EXISTS idx_click_events_bot ON click_events(bot);

-- =============================================================================
-- TABLE: aggregated_stats
-- =============================================================================

CREATE TABLE IF NOT EXISTS aggregated_stats (
    id              BIGSERIAL PRIMARY KEY,
    link_id         BIGINT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    date            DATE NOT NULL,
    clicks          BIGINT NOT NULL DEFAULT 0,
    unique_visitors BIGINT NOT NULL DEFAULT 0,
    
    -- Unique constraint: one row per link per day
    CONSTRAINT uq_aggregated_stats_link_date UNIQUE (link_id, date)
);

-- Comments
COMMENT ON TABLE aggregated_stats IS 'Pre-aggregated daily statistics per link for fast dashboard queries';
COMMENT ON COLUMN aggregated_stats.date IS 'Date for aggregation (no time component)';
COMMENT ON COLUMN aggregated_stats.clicks IS 'Total clicks for this link on this date';
COMMENT ON COLUMN aggregated_stats.unique_visitors IS 'Unique visitors based on IP hash';

-- Indexes
-- Date range queries
CREATE INDEX IF NOT EXISTS idx_aggregated_stats_date ON aggregated_stats(date);

-- Link-specific stats
CREATE INDEX IF NOT EXISTS idx_aggregated_stats_link_id ON aggregated_stats(link_id);

-- =============================================================================
-- TABLE: reserved_aliases
-- =============================================================================

CREATE TABLE IF NOT EXISTS reserved_aliases (
    id          BIGSERIAL PRIMARY KEY,
    alias       VARCHAR(50) NOT NULL UNIQUE,
    reason      TEXT,
    category    VARCHAR(50),
    reserved_by VARCHAR(100),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Comments
COMMENT ON TABLE reserved_aliases IS 'Reserved aliases that cannot be used as short codes';
COMMENT ON COLUMN reserved_aliases.alias IS 'The reserved alias (case-insensitive matching)';
COMMENT ON COLUMN reserved_aliases.reason IS 'Why this alias is reserved';
COMMENT ON COLUMN reserved_aliases.category IS 'Category: system, brand, profanity, etc.';
COMMENT ON COLUMN reserved_aliases.reserved_by IS 'Who reserved it (admin ID or "system")';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reserved_aliases_alias ON reserved_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_reserved_aliases_category ON reserved_aliases(category);

-- =============================================================================
-- FUNCTIONS: Auto-update updated_at
-- =============================================================================

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for users
DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for links
DROP TRIGGER IF EXISTS links_updated_at ON links;
CREATE TRIGGER links_updated_at
    BEFORE UPDATE ON links
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- SEED: Initial reserved aliases (system routes)
-- =============================================================================

INSERT INTO reserved_aliases (alias, reason, category, reserved_by) VALUES
    ('api', 'API endpoint prefix', 'system', 'system'),
    ('v1', 'API version prefix', 'system', 'system'),
    ('v2', 'API version prefix', 'system', 'system'),
    ('health', 'Health check endpoint', 'system', 'system'),
    ('ready', 'Readiness probe endpoint', 'system', 'system'),
    ('live', 'Liveness probe endpoint', 'system', 'system'),
    ('metrics', 'Prometheus metrics endpoint', 'system', 'system'),
    ('admin', 'Admin dashboard route', 'system', 'system'),
    ('login', 'Authentication route', 'system', 'system'),
    ('logout', 'Authentication route', 'system', 'system'),
    ('signup', 'Authentication route', 'system', 'system'),
    ('dashboard', 'User dashboard route', 'system', 'system'),
    ('settings', 'User settings route', 'system', 'system'),
    ('profile', 'User profile route', 'system', 'system'),
    ('links', 'Links management route', 'system', 'system'),
    ('quicklink', 'Brand name', 'brand', 'system'),
    ('ql', 'Brand abbreviation', 'brand', 'system')
ON CONFLICT (alias) DO NOTHING;

-- =============================================================================
-- GRANTS (adjust based on your database user setup)
-- =============================================================================

-- Grant permissions to application user (adjust 'quicklink' to your user)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO quicklink;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO quicklink;

-- =============================================================================
-- NOTES FOR PRODUCTION
-- =============================================================================
--
-- 1. PARTITIONING (when click_events > 100M rows):
--    ALTER TABLE click_events PARTITION BY RANGE (created_at);
--    Create monthly/weekly partitions
--
-- 2. ARCHIVAL STRATEGY:
--    Move old click_events to cold storage (S3, etc.)
--    Keep aggregated_stats for historical dashboards
--
-- 3. CONNECTION POOLING:
--    Use PgBouncer or Prisma's connection pooling
--    Redirect service needs fast connections
--
-- 4. REPLICATION:
--    Read replicas for analytics queries
--    Primary for writes (link creation, click events)
--
-- 5. MONITORING:
--    pg_stat_statements for slow query detection
--    Monitor index usage with pg_stat_user_indexes
--
-- =============================================================================
