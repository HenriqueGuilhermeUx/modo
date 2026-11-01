FROM node:22-bookworm-slim
RUN apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates && rm -rf /var/lib/apt/lists/* && useradd -u 10001 -m -s /usr/sbin/nologin pilot
WORKDIR /app
COPY server.mjs /app/server.mjs
COPY index.html /app/index.html
ENV NODE_ENV=production PORT=10000
USER 10001:10001
EXPOSE 10000
CMD ["node","server.mjs"]
