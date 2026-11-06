# Build stage
FROM node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source files
COPY . .

# Vite configuration is embedded at build time. Only public configuration belongs here.
ARG VITE_DISCORD_CLIENT_ID
ARG VITE_API_URL
ARG VITE_ENVIRONMENT=production
ARG VITE_DISCORD_REDIRECT_URI
ENV VITE_DISCORD_CLIENT_ID=$VITE_DISCORD_CLIENT_ID \
    VITE_API_URL=$VITE_API_URL \
    VITE_ENVIRONMENT=$VITE_ENVIRONMENT \
    VITE_DISCORD_REDIRECT_URI=$VITE_DISCORD_REDIRECT_URI
RUN npm run build
ARG SOURCE_REVISION=development
RUN node -e 'const fs = require("node:fs"); const r = process.argv[1]; if (r !== "development" && !/^[0-9a-f]{40}$/.test(r)) throw new Error("Invalid source revision"); fs.writeFileSync("dist/build-info.json", JSON.stringify({schema_version: 1, repository: "subculture-collective/backline", source_commit: r}) + "\n");' "$SOURCE_REVISION"

# Production stage
FROM nginx:alpine@sha256:b2f80f8f88146b0772fdcc7d92cea621aa8c2889fa8d07ed61d4884fcea53e09
ARG SOURCE_REVISION=development
LABEL org.opencontainers.image.revision="$SOURCE_REVISION" \
      org.opencontainers.image.source="https://git.subcult.tv/subculture-collective/backline"

# Copy built files from builder
RUN rm -rf /usr/share/nginx/html
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost/health || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
