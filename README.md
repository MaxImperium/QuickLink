# QuickLink

A production-ready URL shortener platform built with modern technologies and best practices.

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              LOAD BALANCER / CDN                            │
└─────────────────────────────────────────────────────────────────────────────┘
         │                           │                          │
         ▼                           ▼                          ▼
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│    Web (Next)   │       │   API (Fastify) │       │    Redirect     │
│   Port: 3000    │       │   Port: 3001    │       │   Port: 3002    │
│                 │       │                 │       │   (Hot Path)    │
│  • Dashboard    │       │  • CRUD Links   │       │                 │
│  • Analytics    │───────▶  • Auth         │       │  • Fast lookup  │
│  • Admin UI     │       │  • Admin API    │       │  • 301/302      │
│                 │       │  • Rate Limit   │       │  • Fire events  │
└─────────────────┘       └─────────────────┘       └─────────────────┘
                                   │                          │
                                   ▼                          │
                          ┌─────────────────┐                 │
                          │   PostgreSQL    │                 │
                          │   (Primary DB)  │                 │
                          └─────────────────┘                 │
                                   │                          │
                                   ▼                          ▼
                          ┌─────────────────────────────────────┐
                          │              Redis                  │
                          │   • Cache (URL mappings)            │
                          │   • Queue (Click events)            │
                          │   • Sessions (Future)               │
                          └─────────────────────────────────────┘
                                          │
                                          ▼
                          ┌─────────────────────────────────────┐
                          │        Analytics Worker             │
                          │   • Process click events            │
                          │   • Aggregate statistics            │
                          │   • Write to PostgreSQL             │
                          └─────────────────────────────────────┘
```

## 📁 Project Structure

```
quicklink/
├── apps/
│   ├── web/                 # Next.js frontend (App Router)
│   │   └── src/
│   │       ├── app/         # Next.js pages
│   │       ├── components/  # React components
│   │       ├── hooks/       # Custom React hooks
│   │       └── lib/         # Utility functions
│   │
│   ├── api/                 # Fastify backend API
│   │   └── src/
│   │       ├── routes/      # API route handlers
│   │       ├── plugins/     # Fastify plugins
│   │       └── services/    # Business logic
│   │
│   └── redirect/            # High-performance redirect service
│       └── src/
│           ├── routes/      # Redirect handlers
│           └── services/    # URL lookup
│
├── packages/
│   ├── config/              # Shared ESLint, TypeScript configs
│   ├── db/                  # Prisma schema & migrations
│   ├── cache/               # Redis abstraction
│   ├── analytics/           # Event processing (BullMQ)
│   ├── logger/              # Structured logging (Pino)
│   └── shared/              # Shared types & utilities
│
├── docker/                  # Dockerfiles for each service
├── scripts/                 # Development & deployment scripts
└── .github/workflows/       # CI/CD pipelines
```

## 🎯 Key Design Decisions

### 1. **Separate Redirect Service**
The redirect service is intentionally decoupled from the main API:
- **Performance**: Minimal dependencies for sub-10ms latency
- **Scalability**: Can scale independently based on traffic
- **Reliability**: Reduced failure surface area
- **Cost**: Lower resource requirements per instance

### 2. **Cache-First Strategy**
URL mappings are cached in Redis:
- Hot paths never hit the database
- Cache populated on write and lazy-loaded on miss
- TTL-based expiration with background refresh

### 3. **Async Analytics**
Click events are processed asynchronously:
- Redirect service fires events to queue (fire-and-forget)
- Workers batch-process events for efficient DB writes
- Pre-aggregated stats for dashboard queries

### 4. **Monorepo with Turborepo**
Benefits:
- Shared code without publishing packages
- Cached builds for faster CI/CD
- Atomic changes across services
- Consistent tooling and standards

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- pnpm 8+
- Docker & Docker Compose

### Setup
```bash
# Clone the repository
git clone https://github.com/your-org/quicklink.git
cd quicklink

# Run setup script
./scripts/setup.sh

# Or manually:
cp .env.example .env.local
pnpm install
docker-compose up -d
pnpm db:generate
pnpm dev
```

### Available Commands
```bash
pnpm dev          # Start all services in development
pnpm build        # Build all packages and apps
pnpm lint         # Lint all packages
pnpm test         # Run all tests
pnpm typecheck    # TypeScript type checking
pnpm db:studio    # Open Prisma Studio
```

## 🔧 Configuration

Environment variables are documented in [.env.example](.env.example).

Key configurations:
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `API_PORT` / `REDIRECT_PORT` - Service ports

## 📊 Services

| Service | Port | Purpose |
|---------|------|---------|
| Web | 3000 | Next.js frontend |
| API | 3001 | Core backend API |
| Redirect | 3002 | URL redirect service |
| PostgreSQL | 5432 | Primary database |
| Redis | 6379 | Cache & queue |

## 🔮 Roadmap

### Phase 1: Foundation (Current)
- [x] Project structure
- [ ] Basic CRUD for links
- [ ] Redirect service
- [ ] Cache layer

### Phase 2: Features
- [ ] User authentication
- [ ] Custom short codes
- [ ] Link expiration
- [ ] QR code generation

### Phase 3: Analytics
- [ ] Click tracking
- [ ] Geographic data
- [ ] Referrer tracking
- [ ] Dashboard charts

### Phase 4: Scale
- [ ] Rate limiting
- [ ] API key management
- [ ] Multi-tenancy
- [ ] Kubernetes deployment

## 🧪 Testing

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:ci
```

## 📦 Deployment

### Docker
```bash
# Build images
docker-compose -f docker-compose.yml build

# Deploy with compose
docker-compose -f docker-compose.yml up -d
```

### Kubernetes
See `k8s/` directory (coming soon) for Helm charts and manifests.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.
