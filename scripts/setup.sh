#!/bin/bash
# =============================================================================
# QuickLink - Development Environment Setup
# =============================================================================

set -e

echo "🚀 Setting up QuickLink development environment..."

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required but not installed."; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "❌ pnpm is required but not installed. Run: npm install -g pnpm"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "⚠️  Docker is not installed. Database and Redis will not be available locally."; }

# Create .env.local from example
if [ ! -f .env.local ]; then
  echo "📝 Creating .env.local from .env.example..."
  cp .env.example .env.local
  echo "✅ Created .env.local - please update with your local settings"
fi

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install

# Start infrastructure (if Docker is available)
if command -v docker >/dev/null 2>&1; then
  echo "🐳 Starting PostgreSQL and Redis..."
  docker-compose up -d postgres redis
  
  # Wait for services to be ready
  echo "⏳ Waiting for services to be ready..."
  sleep 5
fi

# Generate Prisma client
echo "🔧 Generating Prisma client..."
pnpm db:generate

# Run database migrations (development)
if command -v docker >/dev/null 2>&1; then
  echo "🗃️  Running database migrations..."
  pnpm --filter @quicklink/db db:migrate:dev
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "  1. Review and update .env.local"
echo "  2. Run 'pnpm dev' to start all services"
echo "  3. Visit http://localhost:3000 for the web app"
echo "  4. API available at http://localhost:3001"
echo "  5. Redirect service at http://localhost:3002"
echo ""
