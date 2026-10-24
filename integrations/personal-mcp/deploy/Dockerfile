FROM node:24.22.1-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends procps && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build:cached
WORKDIR /app/integrations/personal-mcp
RUN npm ci --ignore-scripts --omit=dev --no-audit --no-fund
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8788
CMD ["node", "src/main.mjs", "/run/rea/config.json"]
