FROM node:22-alpine
WORKDIR /srv/sitio
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY servidor.mjs ./
ENV NODE_ENV=production RAIZ=/app PUERTO=3100
EXPOSE 3100
USER node
CMD ["node", "servidor.mjs"]
