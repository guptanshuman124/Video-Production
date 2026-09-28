# One image for the whole factory (deploy/k8s/factory.yaml):
#   central   node src/cli.js central   backend + scheduler + dashboard
#   worker    node src/cli.js worker    content generation, voice, render, QA
# Built and loaded into the local cluster by `npm run factory -- up`.

# ---- dashboard -------------------------------------------------------------
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- runtime: Node + headless Chromium + ffmpeg ----------------------------
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium ffmpeg fonts-noto-core fonts-noto-color-emoji ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV HVR_CHROME=/usr/bin/chromium \
    HVR_FFMPEG=/usr/bin/ffmpeg \
    HVR_FFPROBE=/usr/bin/ffprobe \
    NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY config ./config
COPY prompts ./prompts
COPY stage ./stage
COPY templates ./templates
COPY src ./src
COPY --from=web /web/dist ./web/dist
ENTRYPOINT ["node", "src/cli.js"]
CMD ["central"]
