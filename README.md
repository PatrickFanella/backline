# Backline

[![Backend CI](https://github.com/subculture-collective/discord-spywatcher/actions/workflows/backend-ci.yml/badge.svg)](https://github.com/subculture-collective/discord-spywatcher/actions/workflows/backend-ci.yml)
[![Frontend CI](https://github.com/subculture-collective/discord-spywatcher/actions/workflows/frontend-ci.yml/badge.svg)](https://github.com/subculture-collective/discord-spywatcher/actions/workflows/frontend-ci.yml)
[![Security Scan](https://github.com/subculture-collective/discord-spywatcher/actions/workflows/security.yml/badge.svg)](https://github.com/subculture-collective/discord-spywatcher/actions/workflows/security.yml)

Backline is a configurable Discord community bot and dashboard for server management, onboarding, moderation, engagement, support, audio, and optional activity analytics. It is currently a release candidate in a private pilot.

## 🧩 Features

- Detects multi-client logins (web, mobile, desktop simultaneously)
- Tracks inactive users, lurkers, and behavioral shifts
- Offers analytics endpoints for presence and role drift
- Includes a React-based frontend with dashboards and settings
- Secure Discord OAuth2 authentication
- **Public API** with comprehensive documentation for third-party integrations
- **Official TypeScript/JavaScript SDK** for easy API access
- **Tier-based quotas** with FREE, PRO, and ENTERPRISE subscription tiers
- **Per-endpoint rate limiting** and daily usage quotas
- **Plugin System** for extending functionality with custom features

Design system: [Backline app design system](./docs/design/APP-SYSTEM.md).

## 🏗️ Tech Stack

- **Backend**: Node.js, Express, TypeScript, Prisma, SQLite
- **Bot**: discord.js (presence + message tracking)
- **Frontend**: React + Vite + Tailwind CSS
- **Authentication**: Discord OAuth2 with JWT sessions

## 📦 Monorepo Structure

```bash
backend/        # Discord bot + API server
frontend/       # React + Vite frontend client
sdk/            # TypeScript/JavaScript SDK for API integration
docs/           # VitePress documentation site
.github/        # CI/CD workflows and automation
```

## 📚 Documentation

Development direction: [Community bot expansion roadmap](./docs/developer/bot-expansion-roadmap.md) — server management, onboarding, engagement, support, automation, recovery, and audio, with SUBCULT as the first pilot before broader community installation. These additions are planned; the roadmap separates existing code from new work and defines qualification gates.

Comprehensive documentation is available at multiple levels:

- **[User Guide](./docs/guide/)** - Installation, features, and usage
- **[Admin Guide](./docs/admin/)** - Configuration and operations
- **[Developer Guide](./docs/developer/)** - Architecture and contributing
- **[API Reference](./docs/api/)** - Complete API documentation

### 🌐 Interactive API Documentation

Explore and test the API using our interactive documentation portals:

- **[Swagger UI](http://localhost:3001/api/docs)** - Try it out! Test endpoints directly in your browser
- **[ReDoc](http://localhost:3001/api/redoc)** - Clean, professional API documentation view
- **[OpenAPI Spec](http://localhost:3001/api/openapi.json)** - Raw OpenAPI 3.0 specification

**Quick Links:**

- 📖 [Interactive API Guide](./docs/api/INTERACTIVE_API_GUIDE.md) - Code examples in 6+ languages
- 🔐 [Authentication Guide](./docs/api/AUTHENTICATION_GUIDE.md) - OAuth2 setup and JWT management
- ⚡ [Rate Limiting Guide](./docs/api/RATE_LIMITING_GUIDE.md) - Best practices and optimization

### Building Documentation Locally

```bash
# Start development server
npm run docs:dev

# Build static site
npm run docs:build

# Preview build
npm run docs:preview
```

Documentation is built with [VitePress](https://vitepress.dev/) and includes:

- Interactive search
- Dark mode support
- Mobile-responsive design
- Code examples in multiple languages
- Comprehensive guides for all features

## 🔄 CI and releases

Gitea is the source of record for Backline. Its action-compatible workflows run the backend, frontend, database, and image checks for pull requests and reviewed revisions.

Deployments are operator-controlled. Select immutable backend and dashboard image digests from the reviewed Gitea revision, run the migration barrier, and verify the bot heartbeat, API readiness, and dashboard health. Follow [Deploy a Backline release](./DEPLOYMENT.md) for the release procedure and proof boundaries.

The GitHub mirror and the legacy GitHub/AWS deployment workflows are not a release path.

## 🚀 Getting Started

### Using Docker (Recommended)

The easiest way to run the application is using Docker:

```bash
# Copy environment file and configure
cp .env.example .env
# Edit .env with your Discord credentials

# Start development environment
docker-compose -f docker-compose.dev.yml up
```

Access the application:

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001
- PostgreSQL: localhost:5432

See [DOCKER.md](./DOCKER.md) for detailed Docker setup and usage.

### Manual Setup

#### Backend

```bash
cd backend
npm install
npx prisma migrate dev --name init
npm run dev          # Start Discord bot
npm run dev:api      # Start API server
```

#### Frontend

```bash
cd frontend
npm install
npm run dev
```

## 🧪 Testing

The project includes comprehensive unit, integration, and end-to-end tests.

### Backend Tests

```bash
cd backend
npm test                  # Run all tests
npm run test:watch        # Run tests in watch mode
npm run test:coverage     # Run tests with coverage report
npm run test:unit         # Run only unit tests
npm run test:integration  # Run only integration tests
```

### Frontend Tests

```bash
cd frontend
npm test                  # Run unit/integration tests
npm run test:watch        # Run tests in watch mode
npm run test:coverage     # Run tests with coverage report
npm run test:e2e          # Run E2E tests with Playwright
npm run test:e2e:ui       # Run E2E tests with Playwright UI
```

**Test Coverage:**

- Backend: >80% code coverage (55 tests)
- Frontend: >70% code coverage (19 tests)

For detailed testing documentation, see [TESTING.md](./TESTING.md).

## 🔐 Environment Variables

Backline uses environment variables for configuration with strict validation to ensure security and proper setup.

### Backend Configuration

Copy `backend/.env.example` to `backend/.env` and configure the following variables:

#### Required Variables

| Variable                | Description                             | Example                               | Validation        |
| ----------------------- | --------------------------------------- | ------------------------------------- | ----------------- |
| `DISCORD_BOT_TOKEN`     | Discord bot token from Developer Portal | `MTk...`                              | Min 50 characters |
| `DISCORD_CLIENT_ID`     | OAuth2 client ID                        | `123456789`                           | Min 10 characters |
| `DISCORD_CLIENT_SECRET` | OAuth2 client secret                    | `abc123...`                           | Min 20 characters |
| `DISCORD_REDIRECT_URI`  | OAuth2 redirect URI                     | `http://localhost:5173/auth/callback` | Valid URL         |
| `JWT_SECRET`            | Secret for signing access tokens        | `random-32-char-string`               | Min 32 characters |
| `JWT_REFRESH_SECRET`    | Secret for signing refresh tokens       | `another-32-char-string`              | Min 32 characters |

#### Optional Variables

| Variable                     | Description                          | Default                  | Validation                                     |
| ---------------------------- | ------------------------------------ | ------------------------ | ---------------------------------------------- |
| `NODE_ENV`                   | Environment mode                     | `development`            | `development`, `staging`, `production`, `test` |
| `PORT`                       | Server port                          | `3001`                   | Positive integer                               |
| `DATABASE_URL`               | PostgreSQL connection string         | -                        | Valid URL                                      |
| `DISCORD_GUILD_ID`           | Optional specific guild ID           | -                        | String                                         |
| `BOT_GUILD_IDS`              | Comma-separated guild IDs to monitor | -                        | Comma-separated list                           |
| `ADMIN_DISCORD_IDS`          | Comma-separated admin user IDs       | -                        | Comma-separated list                           |
| `CORS_ORIGINS`               | Comma-separated allowed origins      | `http://localhost:5173`  | Comma-separated URLs                           |
| `JWT_ACCESS_EXPIRES_IN`      | Access token expiration              | `15m`                    | Time string                                    |
| `JWT_REFRESH_EXPIRES_IN`     | Refresh token expiration             | `7d`                     | Time string                                    |
| `REDIS_URL`                  | Redis connection string              | `redis://localhost:6379` | Valid URL                                      |
| `ENABLE_RATE_LIMITING`       | Enable rate limiting                 | `true`                   | `true` or `false`                              |
| `ENABLE_REDIS_RATE_LIMITING` | Enable Redis-backed rate limiting    | `true`                   | `true` or `false`                              |
| `ENABLE_IP_BLOCKING`         | Enable IP blocking                   | `true`                   | `true` or `false`                              |
| `ENABLE_LOAD_SHEDDING`       | Enable load shedding under high load | `true`                   | `true` or `false`                              |
| `LOG_LEVEL`                  | Logging level                        | `info`                   | `error`, `warn`, `info`, `debug`               |
| `FRONTEND_URL`               | Frontend URL for redirects           | -                        | Valid URL                                      |

**Generate secure secrets:**

```bash
# Generate JWT secrets
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Frontend Configuration

Copy `frontend/.env.example` to `frontend/.env` and configure:

| Variable                     | Description               | Example                     | Required                    |
| ---------------------------- | ------------------------- | --------------------------- | --------------------------- |
| `VITE_API_URL`               | Backend API base URL      | `http://localhost:3001/api` | Yes                         |
| `VITE_DISCORD_CLIENT_ID`     | Discord OAuth2 client ID  | `123456789`                 | Yes                         |
| `VITE_ENVIRONMENT`           | Environment mode          | `development`               | No (default: `development`) |
| `VITE_ENABLE_ANALYTICS`      | Enable analytics tracking | `false`                     | No (default: `false`)       |
| `VITE_ANALYTICS_TRACKING_ID` | Analytics tracking ID     | -                           | No                          |

**Important Notes:**

- All frontend variables must be prefixed with `VITE_` to be exposed to the browser
- Never include secrets in frontend environment variables
- Frontend variables are embedded in the build and publicly accessible
- The application will fail to start if required variables are missing or invalid

### Environment Validation

The backend uses [Zod](https://zod.dev/) for runtime environment validation:

- All required variables are validated on startup
- Type safety is enforced (strings, numbers, URLs, enums)
- Clear error messages for missing or invalid configuration
- Application exits with code 1 if validation fails

Example validation error:

```
❌ Invalid environment configuration:

  - DISCORD_BOT_TOKEN: Discord bot token must be at least 50 characters
  - JWT_SECRET: JWT secret must be at least 32 characters
  - DISCORD_REDIRECT_URI: Discord redirect URI must be a valid URL

💡 Check your .env file and ensure all required variables are set correctly.
```

## 🛡️ Security & Rate Limiting

Backline implements comprehensive security measures to protect against abuse and ensure service availability:

- **Multi-layer rate limiting** with Redis-backed distributed storage
- **DDoS protection** including request validation, parameter limits, and header validation
- **IP blocking** with automatic abuse detection
- **Load management** with circuit breakers and load shedding under high load

See [RATE_LIMITING.md](./RATE_LIMITING.md) for detailed documentation on:

- Rate limiting configuration
- Endpoint-specific limits
- DDoS protection mechanisms
- Load shedding behavior
- Admin APIs for IP management

## 🗄️ Database & Connection Pooling

Backline uses PostgreSQL with PgBouncer for efficient connection pooling and resource management:

- **PgBouncer** - Transaction-mode connection pooling for optimal performance
- **Prisma** - Type-safe database access with connection pool monitoring
- **Redis** - Distributed caching and rate limiting with connection management
- **Graceful shutdown** - Proper connection cleanup on application shutdown

See [CONNECTION_POOLING.md](./CONNECTION_POOLING.md) for detailed documentation on:

- PgBouncer setup and configuration
- Connection pool monitoring and metrics
- Database health checks and alerting
- Performance optimization strategies
- Troubleshooting connection issues

Additional database documentation:

- [POSTGRESQL.md](./POSTGRESQL.md) - PostgreSQL setup and management
- [DATABASE_OPTIMIZATION.md](./DATABASE_OPTIMIZATION.md) - Query optimization and indexing
- [docs/PGBOUNCER_SETUP.md](./docs/PGBOUNCER_SETUP.md) - Quick reference guide

## 🔄 Backup & Disaster Recovery

Backline implements comprehensive backup and disaster recovery procedures to ensure data safety and business continuity:

- **Automated Backups** - Daily full backups and 6-hour incremental backups
- **WAL Archiving** - Point-in-time recovery (PITR) capability
- **Encrypted Backups** - GPG encryption for backup security
- **Multi-Region Storage** - Primary and secondary S3 buckets for redundancy
- **Backup Monitoring** - Automated health checks and alerting
- **Recovery Procedures** - Documented runbooks for various disaster scenarios

**Recovery Objectives:**

- **RTO** (Recovery Time Objective): < 4 hours
- **RPO** (Recovery Point Objective): < 1 hour

See [DISASTER_RECOVERY.md](./DISASTER_RECOVERY.md) for detailed documentation on:

- Backup strategy and configuration
- Automated backup scripts and schedules
- WAL archiving setup for PITR
- Recovery procedures for different scenarios
- Testing and drill schedules
- Monitoring and alerting setup

**Quick Commands:**

```bash
# Manual database backup
cd backend && npm run db:backup

# Restore from backup
cd backend && npm run db:restore

# Setup WAL archiving
cd scripts && ./setup-wal-archiving.sh

# Check backup health
cd backend && npm run backup:health-check
```

## 📊 Monitoring & Observability

Backline includes comprehensive monitoring and observability features:

- **Sentry** - Error tracking and Application Performance Monitoring (APM)
- **Prometheus** - Metrics collection for system and application metrics
- **Winston** - Structured JSON logging with request correlation
- **Health checks** - Liveness and readiness probes for orchestrators
- **Grafana Loki** - Centralized log aggregation and analysis
- **Promtail** - Log collection and shipping from all services
- **Grafana** - Unified dashboards for logs and metrics

See [MONITORING.md](./MONITORING.md) for detailed documentation on:

- Sentry configuration and error tracking
- Prometheus metrics and custom instrumentation
- Health check endpoints
- Structured logging best practices
- Alert configuration examples
- Grafana dashboard creation

See [LOGGING.md](./LOGGING.md) for centralized logging documentation:

- Log aggregation with Grafana Loki
- Log search and filtering with LogQL
- Log retention policies (30-day default)
- Security event tracking
- Performance tuning and troubleshooting

## 🌐 Endpoints

Available at `http://localhost:3001`

### Analytics Routes

- `GET` `/ghosts`
- `GET` `/heatmap`
- `GET` `/lurkers`
- `GET` `/roles`
- `GET` `/clients`
- `GET` `/shifts`

#### Auth Routes

- `GET` `/discord`
- `POST` `/refresh`
- `POST` `/logout`
- `GET` `/me`
- `GET` `/settings`
- `GET` `/admin/users`
- `GET` `/debug/user/:discordId`

#### Bans Routes

- `GET` `/banned`
- `POST` `/ban`
- `POST` `/unban`
- `GET` `/userbans`
- `POST` `/userban`
- `POST` `/userunban`

#### Suspicion Routes

- `GET` `/suspicion`

## 🌐 Public API & SDK

Backline provides a comprehensive public API for third-party integrations with an official TypeScript/JavaScript SDK.

### Quick Start with SDK

```bash
npm install @spywatcher/sdk
```

```typescript
import { Spywatcher } from '@spywatcher/sdk';

const client = new Spywatcher({
    baseUrl: 'http://localhost:3001/api',
    apiKey: 'spy_live_your_api_key_here',
});

// Get ghost users
const ghosts = await client.analytics.getGhosts();

// Get suspicion data
const suspicions = await client.getSuspicionData();
```

### API Documentation

- **[Interactive API Documentation](./docs/API_DOCUMENTATION.md)** - OpenAPI/Swagger docs with screenshots
    - **Swagger UI**: `/api/docs` - Interactive testing interface
    - **ReDoc**: `/api/redoc` - Clean, professional documentation view
    - **OpenAPI Spec**: `/api/openapi.json` - Raw OpenAPI 3.0 specification
- **[Public API Reference](./docs/PUBLIC_API.md)** - Complete API documentation with examples
- **[Developer Guide](./docs/DEVELOPER_GUIDE.md)** - Step-by-step guide for building integrations
- **[SDK Documentation](./sdk/README.md)** - TypeScript/JavaScript SDK usage guide
- **[SDK Examples](./sdk/examples/)** - Complete example applications

### Features

- ✅ RESTful API with comprehensive endpoints
- ✅ API key authentication with OAuth2
- ✅ TypeScript SDK with full type definitions
- ✅ **Tier-based quota system** (FREE, PRO, ENTERPRISE)
- ✅ **Usage tracking** with daily quotas per endpoint category
- ✅ Rate limiting and security protection
- ✅ Complete API documentation (JSON & OpenAPI 3.0)
- ✅ Code examples in multiple languages
- ✅ Developer guides and best practices

### API Endpoints

Access API documentation at `/api/public/docs` or see the [Public API Reference](./docs/PUBLIC_API.md).

## 🔌 Plugin System

Backline includes a comprehensive plugin system for extending functionality without modifying core code.

### Features

- ✅ **Dynamic Plugin Loading** - Load plugins at runtime
- ✅ **Permission System** - Granular access control for plugins
- ✅ **Event Hooks** - Hook into Discord events, API requests, and analytics
- ✅ **API Routes** - Plugins can register custom API endpoints
- ✅ **Service Access** - Access to database, cache, WebSocket, and more
- ✅ **Lifecycle Management** - Start, stop, and reload plugins dynamically

### Quick Start

Create a new plugin:

```bash
# Copy the template
cp -r backend/plugins/template backend/plugins/my-plugin

# Edit manifest and implement your plugin
cd backend/plugins/my-plugin
nano manifest.json
nano index.js

# Restart Backline to load the plugin
npm run dev:api
```

### Example Plugins

The repository includes three example plugins:

1. **Message Logger** (`backend/plugins/examples/message-logger/`)
    - Logs all Discord messages to a file
    - Demonstrates basic plugin structure and Discord event hooks

2. **Analytics Extension** (`backend/plugins/examples/analytics-extension/`)
    - Adds custom analytics API endpoints
    - Shows database access and Redis caching

3. **Webhook Notifier** (`backend/plugins/examples/webhook-notifier/`)
    - Sends notifications to external webhooks
    - Demonstrates network access and event monitoring

### Plugin Management API

Manage plugins via REST API:

```bash
# List all plugins
GET /api/plugins

# Get plugin details
GET /api/plugins/:id

# Start a plugin
POST /api/plugins/:id/start

# Stop a plugin
POST /api/plugins/:id/stop

# Check plugin health
GET /api/plugins/:id/health
```

### Documentation

- **[Plugin System Guide](./PLUGIN_SYSTEM.md)** - Complete developer guide
- **[Plugin Template](./backend/plugins/template/)** - Ready-to-use template
- **[Example Plugins](./backend/plugins/examples/)** - Working examples
- **[Plugin README](./backend/plugins/README.md)** - Quick reference

## 📊 Frontend Dashboard

- Visualize active/inactive users
- Detect suspicious logins
- Access admin-only controls and settings

## 🛠️ Build for Production

```bash
cd frontend
npm run build
```

Then serve using any static file host (e.g. Netlify, GitHub Pages)

## 🎨 Code Quality

This project uses comprehensive code quality tooling:

- **ESLint**: TypeScript linting with security and accessibility rules
- **Prettier**: Consistent code formatting
- **Husky**: Git hooks for pre-commit and pre-push validation
- **lint-staged**: Run linters on staged files only
- **Commitlint**: Enforce conventional commit messages
- **TypeScript**: Strict mode enabled with additional checks

### Running Linters

```bash
# Lint backend
cd backend && npm run lint

# Lint frontend
cd frontend && npm run lint

# Lint both (from root)
npm run lint

# Auto-fix issues
npm run lint:fix

# Format code
npm run format

# Type check
npm run type-check
```

### Git Hooks

Git hooks are automatically installed when you run `npm install` in the root directory:

- **Pre-commit**: Runs ESLint and Prettier on staged files
- **Pre-push**: Runs TypeScript type checking
- **Commit-msg**: Validates commit message format

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed guidelines.

## 🚀 Production deployment

The supported release topology is [compose.release.yml](./compose.release.yml): PostgreSQL, Redis, one migration barrier, one API, one bot and job worker, and the compiled dashboard. The bot is a singleton because it owns the Discord Gateway session and durable job polling.

Use [Deploy a Backline release](./DEPLOYMENT.md) to prepare private environment files, build the dashboard with public Vite values, select immutable image digests, stage the release, migrate, and verify it. The guide also covers generic backup and disposable restore verification.

`docker-compose.prod.yml`, `deploy.yml`, and `deploy-production.yml` describe legacy paths. The AWS, Kubernetes, and GitHub Container Registry claims in those files are not current Backline deployment instructions. The two legacy deployment workflows are manual-only with no automatic push trigger; do not dispatch them until their infrastructure is separately rebuilt and qualified.

## 👥 Contributions

We welcome contributions from everyone! Please read our [Contributing Guidelines](./CONTRIBUTING.md) to get started.

This project follows a [Code of Conduct](./CODE_OF_CONDUCT.md) to ensure a welcoming environment for all contributors.

---

Made with presence paranoia and healthy curiosity.

## License

Licensed under `GPL-3.0-or-later`. See [LICENSE](LICENSE).
