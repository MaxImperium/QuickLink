#!/bin/bash
# =============================================================================
# QuickLink - Database Reset Script
# =============================================================================
# WARNING: This will delete all data!

set -e

echo "⚠️  WARNING: This will delete all data in the database!"
read -p "Are you sure? (y/N) " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo "🗑️  Dropping database..."
  docker-compose exec postgres psql -U quicklink -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  
  echo "🔧 Running migrations..."
  pnpm --filter @quicklink/db db:migrate:dev
  
  echo "🌱 Seeding database..."
  pnpm --filter @quicklink/db db:seed
  
  echo "✅ Database reset complete!"
else
  echo "❌ Cancelled"
fi
