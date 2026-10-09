FROM node:24-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY shared ./shared
COPY public ./public
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER node
CMD ["node", "server.mjs"]
