-- Migration: Add hashed_password to users table
-- Date: 2024-12-18

-- Add hashed_password column (required for authentication)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS hashed_password VARCHAR(255);

-- Make it NOT NULL (must have a password for auth)
-- First update any existing rows with a placeholder (you should re-hash these)
UPDATE users SET hashed_password = '' WHERE hashed_password IS NULL;
ALTER TABLE users ALTER COLUMN hashed_password SET NOT NULL;

-- Add index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
