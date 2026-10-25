FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY server.js ./
# Utilisateur non-root fourni par l'image node (uid 1000)
USER 1000
EXPOSE 3000
CMD ["node", "server.js"]
