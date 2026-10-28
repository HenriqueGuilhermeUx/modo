# Synthetic-only standalone renderer image. No MODO backend, PostgreSQL,
# encryption material, signing private key, publishing code or network entry.
# All inputs are detached Ed25519 signatures generated outside this image.
FROM node:22-bookworm-slim
RUN apt-get update -qq \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
      ffmpeg ca-certificates unzip fontconfig fonts-dejavu-core \
      libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
      libdbus-1-3 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
      libxrandr2 libgbm1 libasound2 libx11-6 libxext6 libxrender1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home --shell /usr/sbin/nologin renderonly \
    && install -d -o 10001 -g 10001 -m 0700 /home/renderonly

# Explicitly pinned browser client; no runtime npm downloads.
RUN npm install --prefix /opt/static-browser --no-audit --no-fund \
    --ignore-scripts --save-exact puppeteer-core@24.25.0 \
    && test -f /opt/static-browser/node_modules/puppeteer-core/package.json

# Browser artifact is downloaded ONLY while building; runtime network is
# internal-only / no gateway in CI. Exact Chrome revision is verified.
RUN set -eu; \
    mkdir -p /opt/static-chrome; \
    npx --yes @puppeteer/browsers@3.2.6 install \
      chrome-headless-shell@152.0.7977.30 --path /opt/static-chrome; \
    BIN=/opt/static-chrome/chrome-headless-shell/linux-152.0.7977.30/chrome-headless-shell-linux64/chrome-headless-shell; \
    test -x "$BIN"; \
    "$BIN" --version | grep -F '152.0.7977.30'; \
    ln -s "$BIN" /usr/local/bin/hf-pinned-browser

# Unsandboxed nested Chrome is allowed ONLY for synthetic CI. The outer
# Docker sandbox is mandatory; NEVER give this image user-provided HTML.
COPY infra/hyperframes-staging/chrome-headless-wrapper.sh /usr/local/bin/hf-static-chrome
COPY infra/hyperframes-staging/static-renderer-standalone.cjs /opt/static-renderer.cjs
RUN chmod 0755 /usr/local/bin/hf-static-chrome \
    && test ! -e /app/apps/api \
    && test ! -e /run/hyperframes/db-password

ENV NODE_ENV=test HOME=/home/renderonly \
    MODO_HF_STATIC_RENDERER_MODE=synthetic-ci-only

USER 10001:10001
WORKDIR /opt
ENTRYPOINT ["/usr/local/bin/node", "/opt/static-renderer.cjs"]
CMD ["/input/order.json"]
