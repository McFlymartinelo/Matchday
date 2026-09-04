FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache tzdata
ENV TZ=Europe/Paris
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server/index.js"]
