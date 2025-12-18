# CI/CD Pipeline Documentation

This document describes the CI/CD pipeline for the QuickLink monorepo.

## Overview

The pipeline consists of two main workflows:

| Workflow | File | Purpose |
|----------|------|---------|
| **CI** | `.github/workflows/ci.yml` | Lint, build, test, and Docker builds |
| **Deploy** | `.github/workflows/deploy.yml` | Deploy to staging/production |

## CI Pipeline

### Triggers

- **Push** to `main`, `master`, or `develop` branches
- **Pull requests** to `main`, `master`, or `develop` branches

### Jobs

```
┌─────────┐
│  Lint   │ ← ESLint + Prettier
└────┬────┘
     │
┌────┴────┐     ┌────────┐
│  Build  │     │  Test  │ ← Runs in parallel after lint
└────┬────┘     └────┬───┘
     │               │
     └───────┬───────┘
             │
     ┌───────┴───────┐
     │    Docker     │ ← Only on main/master push
     └───────────────┘
```

#### 1. Lint Job
- Runs Prettier format check (`pnpm format:check`)
- Runs ESLint (`pnpm lint`)
- **Fails pipeline** on any lint errors

#### 2. Build Job
- Generates Prisma client
- Runs TypeScript type checking (`pnpm typecheck`)
- Builds all packages (`pnpm build`)
- Uploads build artifacts

#### 3. Test Job
- Spins up PostgreSQL and Redis services
- Runs database migrations
- Executes all tests with coverage (`pnpm test:ci`)
- Uploads coverage to Codecov
- **Fails pipeline** on test failures

#### 4. Docker Job (main branch only)
- Builds Docker images for `api`, `redirect`, `web`
- Pushes to GitHub Container Registry (ghcr.io)
- Uses build cache for faster builds

## Deploy Pipeline

### Triggers

- **Manual dispatch** (workflow_dispatch) with environment selection
- **Push** to `main`/`master` → deploys to **staging**
- **Release published** → deploys to **production**

### Environments

| Environment | Trigger | Approval |
|-------------|---------|----------|
| Staging | Push to main | None |
| Production | Release tag | Environment protection |

### Manual Deployment

To deploy manually:

1. Go to **Actions** → **Deploy** workflow
2. Click **Run workflow**
3. Select environment (`staging` or `production`)
4. Optionally skip test verification
5. Click **Run workflow**

## Running CI/CD Locally

### Prerequisites

```bash
# Install dependencies
pnpm install

# Start infrastructure
docker-compose up -d postgres redis
```

### Running CI Steps Locally

```bash
# 1. Lint
pnpm format:check
pnpm lint

# 2. Build
pnpm db:generate
pnpm typecheck
pnpm build

# 3. Test
export DATABASE_URL="postgresql://quicklink:quicklink@localhost:5432/quicklink_test"
export REDIS_URL="redis://localhost:6379"
export JWT_SECRET="test-secret"
pnpm test:ci
```

### Building Docker Images Locally

```bash
# Build all images
docker build -t quicklink-api -f docker/api/Dockerfile .
docker build -t quicklink-redirect -f docker/redirect/Dockerfile .
docker build -t quicklink-web -f docker/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=http://localhost:3001 \
  --build-arg NEXT_PUBLIC_APP_URL=http://localhost:3000 .

# Or use docker-compose
docker-compose -f docker-compose.yml build
```

### Local Deployment with Docker Compose

```bash
# Development environment
docker-compose up -d

# Staging simulation
docker-compose -f docker-compose.staging.yml up -d

# Production simulation
docker-compose -f docker-compose.production.yml up -d
```

## Environment Variables

### CI Environment

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Set by CI |
| `REDIS_URL` | Redis connection string | Set by CI |
| `JWT_SECRET` | JWT signing secret | Set by CI |
| `NODE_ENV` | Node environment | `test` |

### Deploy Environment

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | Production database URL | Yes |
| `REDIS_URL` | Production Redis URL | Yes |
| `JWT_SECRET` | Production JWT secret | Yes |
| `POSTGRES_PASSWORD` | Database password | Yes |

### GitHub Secrets Required

| Secret | Description |
|--------|-------------|
| `GITHUB_TOKEN` | Auto-provided by GitHub |
| `CODECOV_TOKEN` | Codecov upload token (optional) |

### GitHub Variables (Optional)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | API URL for frontend |
| `NEXT_PUBLIC_APP_URL` | App URL for frontend |
| `STAGING_URL` | Staging environment URL |
| `PRODUCTION_URL` | Production environment URL |

## Coverage Reports

Coverage reports are:
1. Uploaded to **Codecov** (if token configured)
2. Stored as **GitHub artifacts** for 7 days

To view coverage locally:
```bash
pnpm test:coverage
open coverage/lcov-report/index.html
```

## Troubleshooting

### CI Failures

#### Lint Failures
```bash
# Auto-fix formatting
pnpm format

# Auto-fix lint issues
pnpm lint --fix
```

#### Build Failures
```bash
# Check TypeScript errors
pnpm typecheck

# Regenerate Prisma client
pnpm db:generate
```

#### Test Failures
```bash
# Run tests in watch mode
pnpm test:watch

# Run specific test file
pnpm test -- packages/shared/__tests__/shortcode.test.ts
```

### Docker Build Failures

```bash
# Build with verbose output
docker build --progress=plain -t quicklink-api -f docker/api/Dockerfile .

# Check for missing dependencies
docker run --rm quicklink-api npm ls
```

## Pipeline Performance

### Caching Strategy

- **pnpm store**: Cached by GitHub Actions `setup-node`
- **Docker layers**: Cached via GitHub Actions cache
- **Turbo cache**: Local caching for builds

### Optimization Tips

1. Use `--frozen-lockfile` for reproducible installs
2. Run lint and test jobs in parallel
3. Use Docker layer caching
4. Keep coverage thresholds reasonable (80%)

## Security Considerations

1. **Secrets**: Never commit secrets to the repository
2. **Container Registry**: Uses GitHub Container Registry with token auth
3. **Environment Protection**: Production requires approval (configure in GitHub settings)
4. **Non-root Containers**: All Docker images run as non-root users
5. **Dependency Scanning**: Consider adding Dependabot or Snyk

## Extending the Pipeline

### Adding New Packages

1. Add package to workspace in `pnpm-workspace.yaml`
2. Update Dockerfile `COPY` commands if needed
3. Tests will automatically run via turbo

### Adding E2E Tests

```yaml
# In ci.yml, add after test job:
e2e:
  name: E2E Tests
  runs-on: ubuntu-latest
  needs: build
  steps:
    - uses: actions/checkout@v4
    - run: pnpm install
    - run: pnpm test:e2e
```

### Adding Kubernetes Deployment

Replace Docker Compose deployment with:
```yaml
- name: Deploy to Kubernetes
  run: |
    kubectl set image deployment/api api=$IMAGE_PREFIX/api:$VERSION
    kubectl set image deployment/redirect redirect=$IMAGE_PREFIX/redirect:$VERSION
    kubectl set image deployment/web web=$IMAGE_PREFIX/web:$VERSION
    kubectl rollout status deployment/api
```
