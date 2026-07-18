# --- Stage 1: Build the React frontend ---
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# --- Stage 2: Setup the Express server ---
FROM node:20-alpine
WORKDIR /app
COPY server/package*.json ./
RUN npm install --only=production
COPY server/ ./
# Copiar el frontend compilado a la carpeta public de Express
COPY --from=frontend-builder /app/frontend/dist ./public

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000

# Crear la carpeta de datos para persistencia de base de datos
RUN mkdir -p /app/data
ENV DATABASE_PATH=/app/data/yape_payments.db

CMD ["node", "server.js"]
