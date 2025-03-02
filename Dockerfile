FROM node:18

# Instala dependências necessárias para o Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Define o caminho do Chromium como variável de ambiente
ENV CHROMIUM_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

CMD ["node", "index.js"]