# Stage 1 — build
FROM node:20-bookworm-slim AS builder

RUN npm install -g pnpm

WORKDIR /build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Stage 2 — serve via nginx
FROM nginx:alpine

COPY --from=builder /build/dist /usr/share/nginx/html
COPY docker/nginx.conf           /etc/nginx/conf.d/default.conf

EXPOSE 8443

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- --no-check-certificate https://localhost:8443/ || exit 1
