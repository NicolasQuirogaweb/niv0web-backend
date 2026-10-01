FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Primero solo el lockfile: si no cambian las dependencias, Docker reutiliza esta capa.
COPY package*.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .

USER node
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-5000}/health" || exit 1

CMD ["node", "server.js"]
