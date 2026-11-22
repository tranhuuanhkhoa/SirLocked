FROM node:20-alpine AS build
WORKDIR /app
COPY src/FE/package*.json ./
RUN npm ci
COPY src/FE/ ./
RUN npm run build

FROM nginx:stable-alpine
COPY scripts/server/nginx.docker.conf /etc/nginx/conf.d/default.conf
COPY scripts/server/security-headers.conf /etc/nginx/conf.d/security-headers.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
EXPOSE 80
