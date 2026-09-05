# R4 Mine Subsidence Dashboard — Electron Desktop App
#
# NOTE: Electron apps require a display server (X11/Wayland).
# This Dockerfile is provided for completeness, but the recommended
# approach is to run R4 directly on the host machine and connect
# to the Dockerized Mosquitto broker on localhost:1883.
#
# To run on Linux with X11 forwarding:
#   docker run --rm -e DISPLAY=$DISPLAY -v /tmp/.X11-unix:/tmp/.X11-unix r4-dashboard
#
# For development (recommended):
#   cd r4-dashboard && npm start

FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgtk-3-0 \
    libnotify4 \
    libnss3 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    libatspi2.0-0 \
    libdrm2 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY . .

ENV ELECTRON_DISABLE_SANDBOX=1
ENV R4_BROKER_URL=mqtt://host.docker.internal:1883

CMD ["npx", "electron", "."]
