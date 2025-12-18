-- =============================================================================
-- Migration: Click Events Table Partitioning
-- =============================================================================
-- Purpose: Enable PostgreSQL native range partitioning on click_events table
-- for improved query performance at scale.
--
-- Why Partitioning?
-- - click_events grows indefinitely (potentially millions/day at scale)
-- - Queries typically filter by created_at (e.g., "last 7 days")
-- - Partitioning enables partition pruning - only scan relevant months
-- - Old partitions can be detached/archived without affecting active data
-- - Vacuum/analyze operations are per-partition (faster maintenance)
--
-- Strategy: Range partitioning by created_at (monthly partitions)
--
-- Performance Impact:
-- - Queries with created_at filter: 10-100x faster (partition pruning)
-- - INSERT: Negligible overhead (automatic routing)
-- - Without filter: Same or slightly slower (scans all partitions)
--
-- =============================================================================

-- Step 1: Rename existing table to preserve data
ALTER TABLE IF EXISTS click_events RENAME TO click_events_old;

-- Step 2: Create partitioned table structure
-- Note: Partitioned tables cannot have primary keys that don't include
-- the partition key, so we use a composite unique constraint instead.
CREATE TABLE click_events (
    id BIGSERIAL,
    link_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address VARCHAR(45),
    user_agent TEXT,
    referrer TEXT,
    country VARCHAR(2),
    region VARCHAR(100),
    bot BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT click_events_pkey PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Step 3: Create partitions for current and future months
-- We create partitions for the current year and a few months ahead
-- Add more partitions as needed via scheduled job

-- 2024 partitions
CREATE TABLE click_events_y2024m01 PARTITION OF click_events
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
CREATE TABLE click_events_y2024m02 PARTITION OF click_events
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');
CREATE TABLE click_events_y2024m03 PARTITION OF click_events
    FOR VALUES FROM ('2024-03-01') TO ('2024-04-01');
CREATE TABLE click_events_y2024m04 PARTITION OF click_events
    FOR VALUES FROM ('2024-04-01') TO ('2024-05-01');
CREATE TABLE click_events_y2024m05 PARTITION OF click_events
    FOR VALUES FROM ('2024-05-01') TO ('2024-06-01');
CREATE TABLE click_events_y2024m06 PARTITION OF click_events
    FOR VALUES FROM ('2024-06-01') TO ('2024-07-01');
CREATE TABLE click_events_y2024m07 PARTITION OF click_events
    FOR VALUES FROM ('2024-07-01') TO ('2024-08-01');
CREATE TABLE click_events_y2024m08 PARTITION OF click_events
    FOR VALUES FROM ('2024-08-01') TO ('2024-09-01');
CREATE TABLE click_events_y2024m09 PARTITION OF click_events
    FOR VALUES FROM ('2024-09-01') TO ('2024-10-01');
CREATE TABLE click_events_y2024m10 PARTITION OF click_events
    FOR VALUES FROM ('2024-10-01') TO ('2024-11-01');
CREATE TABLE click_events_y2024m11 PARTITION OF click_events
    FOR VALUES FROM ('2024-11-01') TO ('2024-12-01');
CREATE TABLE click_events_y2024m12 PARTITION OF click_events
    FOR VALUES FROM ('2024-12-01') TO ('2025-01-01');

-- 2025 partitions (future-proofing)
CREATE TABLE click_events_y2025m01 PARTITION OF click_events
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE click_events_y2025m02 PARTITION OF click_events
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE click_events_y2025m03 PARTITION OF click_events
    FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE click_events_y2025m04 PARTITION OF click_events
    FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE click_events_y2025m05 PARTITION OF click_events
    FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE click_events_y2025m06 PARTITION OF click_events
    FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');

-- Default partition for any dates outside defined ranges (safety net)
CREATE TABLE click_events_default PARTITION OF click_events DEFAULT;

-- Step 4: Create indexes on the partitioned table
-- These will be automatically created on each partition

-- Primary lookup: link stats for a time range
CREATE INDEX idx_click_events_link_time ON click_events (link_id, created_at DESC);

-- Bot filtering for analytics
CREATE INDEX idx_click_events_bot ON click_events (bot) WHERE bot = true;

-- Geographic queries
CREATE INDEX idx_click_events_country ON click_events (country) WHERE country IS NOT NULL;

-- Step 5: Add foreign key constraint
ALTER TABLE click_events 
    ADD CONSTRAINT click_events_link_id_fkey 
    FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE;

-- Step 6: Migrate existing data (if any)
-- This can take time for large tables - consider doing in batches for production
INSERT INTO click_events (id, link_id, created_at, ip_address, user_agent, referrer, country, region, bot)
SELECT id, link_id, created_at, ip_address, user_agent, referrer, country, region, bot
FROM click_events_old;

-- Step 7: Update sequence to continue from max id
SELECT setval('click_events_id_seq', COALESCE((SELECT MAX(id) FROM click_events), 1));

-- Step 8: Drop old table (after verifying data migration)
DROP TABLE IF EXISTS click_events_old;

-- =============================================================================
-- Maintenance Functions
-- =============================================================================

-- Function to create future partitions automatically
CREATE OR REPLACE FUNCTION create_click_events_partition(partition_date DATE)
RETURNS VOID AS $$
DECLARE
    partition_name TEXT;
    start_date DATE;
    end_date DATE;
BEGIN
    partition_name := 'click_events_y' || TO_CHAR(partition_date, 'YYYY') || 'm' || TO_CHAR(partition_date, 'MM');
    start_date := DATE_TRUNC('month', partition_date);
    end_date := start_date + INTERVAL '1 month';
    
    -- Check if partition already exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = partition_name
    ) THEN
        EXECUTE FORMAT(
            'CREATE TABLE %I PARTITION OF click_events FOR VALUES FROM (%L) TO (%L)',
            partition_name,
            start_date,
            end_date
        );
        RAISE NOTICE 'Created partition: %', partition_name;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to archive old partitions (detach, not delete)
CREATE OR REPLACE FUNCTION archive_click_events_partition(partition_name TEXT)
RETURNS VOID AS $$
BEGIN
    -- Detach partition (data is preserved, just not part of main table)
    EXECUTE FORMAT('ALTER TABLE click_events DETACH PARTITION %I', partition_name);
    
    -- Optionally rename to indicate archived status
    EXECUTE FORMAT('ALTER TABLE %I RENAME TO %I', partition_name, partition_name || '_archived');
    
    RAISE NOTICE 'Archived partition: %', partition_name;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Comments
-- =============================================================================
COMMENT ON TABLE click_events IS 'Click events partitioned by created_at (monthly). Use create_click_events_partition() to add new partitions.';
COMMENT ON FUNCTION create_click_events_partition(DATE) IS 'Creates a monthly partition for click_events if it does not exist.';
COMMENT ON FUNCTION archive_click_events_partition(TEXT) IS 'Detaches and archives an old partition. Data is preserved but queries skip it.';
