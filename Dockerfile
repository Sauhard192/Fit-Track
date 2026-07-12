FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json requirements.txt ./
RUN npm ci \
  && python3 -m pip install --break-system-packages --no-cache-dir -r requirements.txt

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.mjs"]
