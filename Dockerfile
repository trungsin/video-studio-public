# ---- build ----
FROM node:20.20.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx next build

# ---- runtime: Node + Python + ffmpeg + font tiếng Việt ----
FROM node:20.20.1-bookworm-slim
# WITH_VIENEU=1: local VieNeu-TTS + faster-whisper (~1.2 GB models baked into the image); 0 = edge/Gradio only
ARG WITH_VIENEU=1
ENV NODE_ENV=production PORT=3100 HOSTNAME=0.0.0.0 DATA_DIR=/app/data MEDIA_DIR=/app/media PYTHON_BIN=python3 MV_MODELS_DIR=/app/models
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip python3-numpy python3-pil curl ca-certificates fonts-noto-core \
 && pip3 install --break-system-packages --no-cache-dir edge-tts gradio_client opencv-python-headless \
 && if [ "$WITH_VIENEU" = "1" ]; then pip3 install --break-system-packages --no-cache-dir vieneu faster-whisper; fi \
 && mkdir -p /app/worker/fonts \
 && for w in Bold ExtraBold Medium; do curl -fsSL -o /app/worker/fonts/BeVietnamPro-$w.ttf "https://github.com/google/fonts/raw/main/ofl/bevietnampro/BeVietnamPro-$w.ttf"; done \
 && apt-get purge -y curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/worker ./worker
RUN python3 worker/fetch_models.py $( [ "$WITH_VIENEU" = "1" ] && echo --all )
COPY --from=build /app/lib ./lib
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package.json ./package.json
EXPOSE 3100
CMD ["node", "server.js"]
