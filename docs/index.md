---
layout: home

hero:
    name: Backline
    text: Discord Community Tools
    tagline: Server setup, moderation, community modules, and optional activity analytics
    actions:
        - theme: brand
          text: Get Started
          link: /guide/
        - theme: alt
          text: API Reference
          link: /api/
        - theme: alt
          text: View on Gitea
          link: https://git.subcult.tv/subculture-collective/backline

features:
    - icon: 🔍
      title: Ghost Detection
      details: Identify users who are frequently present but rarely participate. Advanced algorithms detect lurkers and potential automated accounts.

    - icon: 📊
      title: Advanced Analytics
      details: Comprehensive analytics with interactive dashboards, heatmaps, and timelines to understand server behavior patterns.

    - icon: 🚨
      title: Suspicion Scoring
      details: Intelligent scoring system identifies unusual behavior patterns and potential security threats automatically.

    - icon: 🔐
      title: Secure & Private
      details: Built with security first. Discord OAuth2 authentication, role-based access control, and privacy-focused analytics.

    - icon: ⚡
      title: Real-time Updates
      details: WebSocket-powered real-time updates keep your dashboard synchronized with live Discord activity.

    - icon: 🛠️
      title: Extensible
      details: Plugin system allows custom features and integrations. REST API and SDK for third-party applications.

    - icon: 📈
      title: Tier-based Quotas
      details: Flexible subscription tiers (FREE, PRO, ENTERPRISE) with rate limiting and daily usage quotas.

    - icon: 🌐
      title: Public API
      details: Comprehensive REST API with OpenAPI documentation, TypeScript/JavaScript SDK, and multi-language code examples.

    - icon: 🐳
      title: Docker Support
      details: Easy deployment with Docker Compose for development and production environments.
---

## Quick Start

Get up and running in minutes:

```bash
# Clone the repository
git clone https://git.subcult.tv/subculture-collective/backline.git
cd backline

# Copy environment configuration
cp .env.example .env

# Start with Docker
docker-compose -f docker-compose.dev.yml up
```

Visit [http://localhost:5173](http://localhost:5173) to access the dashboard.

## Tech Stack

- **Backend**: Node.js, Express, TypeScript, Prisma, PostgreSQL
- **Bot**: discord.js (presence + message tracking)
- **Frontend**: React + Vite + Tailwind CSS
- **Authentication**: Discord OAuth2 with JWT sessions
- **Caching**: Redis
- **Monitoring**: Prometheus, Grafana, Loki

## Documentation Sections

### 👥 [User Guide](/guide/)

Learn how to use Backline's features, from basic setup to advanced analytics.

### 🔧 [Admin Guide](/admin/)

Administration, configuration, and operations for server administrators.

### 💻 [Developer Guide](/developer/)

Development setup, architecture, and contribution guidelines for developers.

### 📚 [API Reference](/api/)

Complete API documentation with examples in multiple languages.

## Community & Support

- **Gitea**: [subculture-collective/backline](https://git.subcult.tv/subculture-collective/backline)
- **Issues**: [Report bugs or request features](https://git.subcult.tv/subculture-collective/backline/issues)
- **Contributing**: [Read our contributing guide](/developer/contributing)

## License

Backline is released under the [GPL-3.0-or-later License](https://git.subcult.tv/subculture-collective/backline/src/branch/main/LICENSE).
