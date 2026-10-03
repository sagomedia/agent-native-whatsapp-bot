FROM node:22.22.1-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci
COPY --chown=node:node . .
RUN npm run build && mkdir -p /app/data/media && chown -R node:node /app/data
USER node
EXPOSE 3000
CMD ["npm", "start"]
