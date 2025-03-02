FROM node:18-slim

# Instala dependências necessárias para o Chromium e Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Define variáveis de ambiente
ENV CHROMIUM_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV NODE_ENV=production

# Configura o diretório de trabalho
WORKDIR /app

# Instala dependências do projeto
COPY package*.json ./
RUN npm install --production

# Copia o restante dos arquivos
COPY . .

# Expõe a porta
EXPOSE 3000

# Comando para iniciar o app
CMD ["node", "index.js"]