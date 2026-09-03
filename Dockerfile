FROM node:20-bookworm-slim AS build

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci

COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/package*.json ./backend/
COPY --from=build /app/backend/dist ./backend/dist
COPY frontend ./frontend

EXPOSE 4000
CMD ["node", "backend/dist/server.js"]
