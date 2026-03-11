FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
  openssl \
  chromium \
  fonts-liberation \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdrm2 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  libgbm1 \
  libnss3 \
  libxss1 \
  libasound2 \
  && rm -rf /var/lib/apt/lists/*

ENV CHROMIUM_PATH=/usr/bin/chromium

WORKDIR /app

# Copy root workspace files
COPY package.json yarn.lock ./
COPY core/package.json ./core/
COPY services/api/package.json ./services/api/

# Install dependencies
RUN yarn install

# Copy source code
COPY tsconfig.json ./
COPY prisma ./prisma/
COPY core ./core/
COPY services/api ./services/api/

# Generate Prisma client
RUN npx prisma generate

EXPOSE 4000

CMD ["node", "-r", "ts-node/register", "services/api/src/index.ts"]
