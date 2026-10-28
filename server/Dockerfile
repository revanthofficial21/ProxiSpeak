# ProxiSpeak server
FROM node:20-alpine

WORKDIR /app

# Dependencies first so this layer caches between builds.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "index.js"]
