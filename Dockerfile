FROM mcr.microsoft.com/playwright:v1.51.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

CMD ["node", "index.js"]
