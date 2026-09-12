FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY contracts ./contracts
COPY config ./config
RUN npm run compile && mkdir -p /app/data && chown -R node:node /app
USER node
CMD ["node", "src/main.js"]
