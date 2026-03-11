FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN yarn install

# Copy source code
COPY . .

# Set production API URLs (config.json is baked into the Next.js build)
ARG API_HOSTNAME=https://commslink.net
ARG WS_HOSTNAME=https://commslink.net
RUN echo "{\"API_HOSTNAME\":\"${API_HOSTNAME}\",\"WS_HOSTNAME\":\"${WS_HOSTNAME}\",\"APP_NAME\":\"CommsLink\",\"APP_VERSION\":\"2.0.0\"}" > settings/config.json

# Build
RUN npx next build

EXPOSE 3000

CMD ["npx", "next", "start"]
