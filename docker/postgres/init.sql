-- PostgreSQL initialization script
-- This runs when the container is first created

-- Enable useful extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Grant permissions (adjust as needed)
GRANT ALL PRIVILEGES ON DATABASE quicklink TO quicklink;
