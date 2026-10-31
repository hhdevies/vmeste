FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=3001
EXPOSE 3001
CMD ["npm", "start"]
