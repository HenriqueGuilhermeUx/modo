# Dedicated staging-only image. Build does not access customer data or secrets.
# Usage: docker build -f infra/hyperframes-staging/worker.Dockerfile -t modo-hf-staging:local .
FROM node:22-bookworm-slim AS build
WORKDIR /build
COPY . .
RUN npm install --include=dev --no-audit --no-fund \
    && npm run build --workspace=@modo/api

FROM node:22-bookworm-slim AS runtime
# These packages are baked into the image at build time: the worker is NEVER
# allowed to fetch binaries or npm packages while executing video jobs.
RUN apt-get update -qq \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
      ffmpeg chromium unzip ca-certificates fontconfig fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home --shell /usr/sbin/nologin hfworker \
    && install -d -o 10001 -g 10001 -m 0700 /home/hfworker

# Chrome's nested sandbox cannot create namespaces under the stronger outer
# Docker sandbox. This wrapper is SYNTHETIC STAGING ONLY; no customer media.
COPY infra/hyperframes-staging/chrome-headless-wrapper.sh /usr/local/bin/hf-chrome
RUN chmod 0755 /usr/local/bin/hf-chrome

# Exact experimental CLI version, not a floating latest tag.
RUN npm install --prefix /opt/hyperframes --no-audit --no-fund \
    --ignore-scripts --save-exact hyperframes@0.8.207 \
    && test -x /opt/hyperframes/node_modules/.bin/hyperframes


# HyperFrames 0.8.207 is verified with Chrome Headless Shell 152.0.7977.30.
# OS package chromium-headless-shell v156 failed its first-frame handshake.
# Browser is installed at IMAGE BUILD time; runtime has NO network access.
# Fail the build if its browser revision changes unexpectedly.
RUN set -eu; \
    mkdir -p /opt/hf-browser/.cache/hyperframes/chrome; \
    npx --yes @puppeteer/browsers@3.2.6 install \
      chrome-headless-shell@152.0.7977.30 \
      --path /opt/hf-browser/.cache/hyperframes/chrome; \
    BIN=/opt/hf-browser/.cache/hyperframes/chrome/chrome-headless-shell/linux-152.0.7977.30/chrome-headless-shell-linux64/chrome-headless-shell; \
    test -x "$BIN"; \
    "$BIN" --version | grep -F '152.0.7977.30'; \
    ln -s "$BIN" /usr/local/bin/hf-pinned-browser

WORKDIR /app
COPY --from=build /build/node_modules /app/node_modules
COPY --from=build /build/packages/contracts/dist /app/packages/contracts/dist
COPY --from=build /build/packages/contracts/package.json /app/packages/contracts/package.json
COPY --from=build /build/apps/api/dist /app/apps/api/dist
COPY --from=build /build/apps/api/package.json /app/apps/api/package.json

ENV NODE_ENV=test \
    HOME=/home/hfworker \
    MODO_HYPERFRAMES_BIN=/opt/hyperframes/node_modules/.bin/hyperframes \
    MODO_HYPERFRAMES_FFPROBE_BIN=/usr/bin/ffprobe \
    HYPERFRAMES_BROWSER_PATH=/usr/local/bin/hf-chrome

# A container is NOT itself a sandbox: docker run/Compose MUST set
# --network none, --read-only, --cap-drop ALL, no-new-privileges, tmpfs /tmp,
# --pids-limit, --memory and --cpus. See isolation CI and operator docs.
USER 10001:10001
ENTRYPOINT ["node","/app/apps/api/dist/scripts/hyperframes-staging-one-shot.js"]
CMD ["/run/hyperframes/order.json"]
