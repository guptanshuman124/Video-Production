# Worker image: Node + headless Chromium + ffmpeg. One container runs one
# shard of a chapter folder:
#
#   docker build -t lecture-factory .
#   docker run --env-file .env -v $PWD/chapters:/app/chapters -v $PWD/jobs:/app/jobs \
#     lecture-factory batch chapters --shard 1/4
#
# Run N containers with --shard 1/N … N/N to split the work; each chapter
# resumes from its folder in jobs/, so restarts lose nothing.

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
RUN npm ci --omit=dev
COPY . .

ENTRYPOINT ["node", "src/cli.js"]
CMD ["packs"]
