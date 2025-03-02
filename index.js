require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const bodyParser = require('body-parser');
const qrcode = require('qrcode');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const fs = require('fs');
const { createClient } = require('@deepgram/sdk');
const vision = require('@google-cloud/vision');
const PDFParser = require('pdf-parse');
const schedule = require('node-schedule');

// Configuração das utilidades
const logger = require('./utils/logger');
const metrics = require('./utils/metrics');

// Configuração do Express
const app = express();
app.use(bodyParser.json());

// Configuração dinâmica
const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8') || '{}');
const defaultConfig = {
    autoReply: true,
    reportTime: '0 0 * * *',
    maxRetries: 3,
    rateLimitMs: 1000,
    apiTimeout: 10000,
};
Object.assign(config, defaultConfig, config);

// Fuso horário (ajuste conforme necessário, ex.: -3 para Brasília)
const TIMEZONE_OFFSET = process.env.TIMEZONE_OFFSET ? parseInt(process.env.TIMEZONE_OFFSET) : -3;

// Variáveis de controle
const startTime = Date.now();
const rateLimitMap = new Map();
const conversationContext = new Map();
const GROUP_ID = process.env.GROUP_ID || 'GGx81qcrRp33sFF6RLpuCd';
const apiFailureCount = new Map();

// Respostas prontas pra mensagens simples
const simpleResponses = [
    "Olá! Como posso ajudá-lo hoje? 🙂",
    "Boa tarde! Tudo bem com você?",
    "Olá! Em que posso colaborar? 😊",
    "Boa noite! Como está?",
    "Olá! Estou à disposição para ajudar. 😉"
];

// Base de conhecimento dos produtos com mensagens de campanha
const products = {
    "cérebro em alta performance": {
        description: "Um e-book para aprimorar sua performance cerebral e promover uma vida saudável!",
        link: "https://renovacaocosmica.shop/23/crb-fnl",
        keywords: ["cérebro", "mente", "saúde mental", "foco"],
        campaignMessages: {
            informal: "E aí, quer turbinar o cérebro e mandar bem em tudo? Esse e-book é o caminho! 😎 Confira: [link]",
            formal: "Olá! Interessado em melhorar sua performance mental? Nosso e-book pode ajudá-lo. Veja mais: [link]"
        }
    },
    "corpo e mente": {
        description: "Recupere o equilíbrio físico e emocional com um método natural e eficaz!",
        link: "https://renovacaocosmica.shop/23/crpint-fnl",
        keywords: ["equilíbrio", "corpo", "mente", "bem-estar"],
        campaignMessages: {
            informal: "Fala, mano! Tá precisando de equilíbrio? Esse método natural é top! 😊 Veja: [link]",
            formal: "Olá! Buscando equilíbrio físico e emocional? Conheça nosso método natural: [link]"
        }
    },
    "saúde imersiva": {
        description: "Cuide da sua saúde com dispositivos vestíveis e realidade aumentada!",
        link: "https://renovacaocosmica.shop/23/fnl-imersiva",
        keywords: ["saúde", "tecnologia", "futuro", "vestíveis"],
        campaignMessages: {
            informal: "E aí, curte tech? Cuide da saúde com estilo usando isso aqui! 😎 Confira: [link]",
            formal: "Olá! Experimente o futuro da saúde com tecnologia avançada. Saiba mais: [link]"
        }
    },
    "saúde do amanhã": {
        description: "Tecnologia inovadora para cuidar da sua saúde com excelência!",
        link: "https://renovacaocosmica.shop/23/fnl-saude",
        keywords: ["saúde", "tecnologia", "inovação"],
        campaignMessages: {
            informal: "Mano, a saúde do futuro tá aqui! Bora cuidar de você? 😊 Veja: [link]",
            formal: "Olá! Conheça a tecnologia que transformará sua saúde. Confira: [link]"
        }
    },
    "sono profundo": {
        description: "Recupere-se com noites de sono profundo e revitalizante!",
        link: "https://renovacaocosmica.shop/23/sono-fnl",
        keywords: ["sono", "dormir", "noite", "descanso"],
        campaignMessages: {
            informal: "Tá rolando noites mal dormidas? Esse aqui resolve, mano! 😴 Confira: [link]",
            formal: "Olá! Melhore suas noites de sono com nosso método eficaz. Veja mais: [link]"
        }
    },
    "rosa xantina": {
        description: "Pele radiante com Rosa Xantina! Reduz linhas finas e manchas de forma eficaz.",
        link: "https://ev.braip.com/ref?pv=pro9y44w&af=afijp7y0qm",
        keywords: ["pele", "beleza", "manchas", "rugas"],
        campaignMessages: {
            informal: "E aí, quer uma pele de dar inveja? Rosa Xantina é o segredo! 😍 Veja: [link]",
            formal: "Olá! Deseja uma pele radiante e saudável? Conheça Rosa Xantina: [link]"
        }
    },
    "os alongamentos essenciais": {
        description: "Apenas 15 minutos diários para melhorar sua flexibilidade e aliviar tensões!",
        link: "https://renovacaocosmica.shop/23/alg-fnl",
        keywords: ["alongamento", "flexibilidade", "tensão", "relaxar"],
        campaignMessages: {
            informal: "Mano, 15 minutinhos e bye-bye tensão! Bora tentar? 😊 Veja: [link]",
            formal: "Olá! Melhore sua flexibilidade com alongamentos simples e eficazes. Confira: [link]"
        }
    },
    "renavidiol cba": {
        description: "Restaure a beleza da sua pele com a tecnologia Canabinoid Active System™!",
        link: "", // Sem link ainda
        keywords: ["pele", "hidratação", "juventude", "firmeza"],
        campaignMessages: {
            informal: "Quer uma pele jovem de novo? Esse aqui é brabo! 😎 Veja mais em breve!",
            formal: "Olá! Restaure sua pele com nossa tecnologia exclusiva. Detalhes em breve!"
        }
    },
    "nervocure": {
        description: "Viva sem dores com Nervocure! Regenera o sistema nervoso de forma segura.",
        link: "https://renovacaocosmica.shop/23/nervocuretic",
        keywords: ["dor", "nervo", "ciático", "formigamento"],
        campaignMessages: {
            informal: "Tá com dor, mano? Nervocure te salva! 😊 Confira: [link]",
            formal: "Olá! Liberte-se das dores com Nervocure. Saiba mais: [link]"
        }
    },
    "100queda": {
        description: "Restaure até 2.000 fios de cabelo por semana com 100Queda!",
        link: "https://ev.braip.com/ref?pv=pro4rxm7&af=afivpggv51",
        keywords: ["cabelo", "queda", "calvície", "fios"],
        campaignMessages: {
            informal: "Cabelo caindo? 100Queda traz ele de volta, mano! 😎 Veja: [link]",
            formal: "Olá! Recupere seus cabelos com 100Queda. Confira agora: [link]"
        }
    },
    "hemogotas": {
        description: "Alívio rápido e seguro para hemorroidas com HemoGotas!",
        link: "https://ev.braip.com/ref?pv=pror2eex&af=afilxjyn16",
        keywords: ["hemorroida", "alívio", "saúde íntima"],
        campaignMessages: {
            informal: "Hemorróida te pegando? HemoGotas resolve rapidão! 😊 Veja: [link]",
            formal: "Olá! Alivie o desconforto com HemoGotas. Conheça mais: [link]"
        }
    }
};

// Banco de dados SQLite
const db = new sqlite3.Database('./groupMessages.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        logger.error('Erro ao conectar ao SQLite:', err.message);
    } else {
        logger.info('Conectado ao banco SQLite.');
    }
});

// Inicialização das tabelas
(async () => {
    try {
        await Promise.all([
            new Promise((resolve, reject) => {
                db.run(`
                    CREATE TABLE IF NOT EXISTS messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        groupId TEXT,
                        date TEXT,
                        message TEXT
                    )
                `, (err) => err ? reject(err) : resolve());
            }),
            new Promise((resolve, reject) => {
                db.run(`
                    CREATE TABLE IF NOT EXISTS knowledge (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        userId TEXT,
                        date TEXT,
                        content TEXT
                    )
                `, (err) => err ? reject(err) : resolve());
            }),
            new Promise((resolve, reject) => {
                db.run(`
                    CREATE TABLE IF NOT EXISTS leads (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        userId TEXT,
                        date TEXT,
                        message TEXT,
                        followedUp INTEGER DEFAULT 0
                    )
                `, (err) => err ? reject(err) : resolve());
            }),
            new Promise((resolve, reject) => {
                db.run(`
                    CREATE TABLE IF NOT EXISTS cache (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        prompt TEXT UNIQUE,
                        response TEXT,
                        date TEXT
                    )
                `, (err) => err ? reject(err) : resolve());
            }),
            new Promise((resolve, reject) => {
                db.run(`
                    CREATE TABLE IF NOT EXISTS usage (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        userId TEXT,
                        command TEXT,
                        date TEXT
                    )
                `, (err) => err ? reject(err) : resolve());
            })
        ]);
        logger.info('Tabelas SQLite inicializadas com sucesso.');
    } catch (err) {
        logger.error('Erro ao inicializar tabelas SQLite:', err.message);
    }
})();

// Configuração das APIs
const deepgram = process.env.DEEPGRAM_API_KEY ? createClient(process.env.DEEPGRAM_API_KEY) : null;
const visionClient = process.env.GOOGLE_VISION_API_KEY ? new vision.ImageAnnotatorClient({ key: process.env.GOOGLE_VISION_API_KEY }) : null;

// Configuração do cliente WhatsApp ajustada para o Render
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './whatsapp-auth' }), // Persistência local, mas cuidado com o Render
    puppeteer: {
        headless: true,
        executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', // Ajuste conforme o ambiente
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // Reduz uso de recursos
            '--disable-gpu'
        ],
        timeout: 120000, // Aumentado para 2 minutos
    },
});

// Variável para armazenar o QR Code
let qrCodeData = '';

client.on('qr', (qr) => {
    qrCodeData = qr;
    logger.info('QR gerado! Acesse /qr para escanear.');
});

client.on('ready', () => {
    logger.info('Bot conectado e pronto para uso.');
    scheduleDailyReport();
    scheduleLeadFollowUps();
    scheduleApiHealthCheck();
});

client.on('auth_failure', (message) => {
    logger.error('Falha na autenticação:', message);
});

client.on('disconnected', (reason) => {
    logger.warn(`Cliente desconectado: ${reason}`);
    setTimeout(() => {
        logger.info('Tentando reconectar...');
        client.initialize().catch(err => logger.error('Erro na reconexão:', err.message, err.stack));
    }, 5000);
});

// Rota para exibir o QR Code
app.get('/qr', async (req, res) => {
    if (!qrCodeData) {
        return res.send('QR não gerado ainda. Aguarde ou reinicie o bot.');
    }
    try {
        const qrImage = await qrcode.toDataURL(qrCodeData);
        res.send(`<img src="${qrImage}" alt="Escaneie este QR Code com o WhatsApp" />`);
    } catch (error) {
        logger.error('Erro ao gerar imagem QR:', error.message);
        res.send('Erro ao gerar o QR Code. Tente novamente.');
    }
});

// Função de retry
async function withRetry(fn, maxRetries = config.maxRetries) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await Promise.race([
                fn(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), config.apiTimeout))
            ]);
        } catch (error) {
            const delay = 1000 * attempt + Math.random() * 500;
            logger.warn(`Tentativa ${attempt}/${maxRetries} falhou: ${error.message}`);
            if (attempt === maxRetries) {
                logger.error(`Falha após ${maxRetries} tentativas na função ${fn.name || 'anônima'}: ${error.message}`, error.stack);
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Salvar mensagens de grupo (desativado)
async function saveGroupMessage(groupId, message) {
    const date = new Date().toISOString().split('T')[0];
    return new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM messages WHERE groupId = ? AND date = ?', [groupId, date], (err, row) => {
            if (err) return reject(err);
            if (row.count >= 1000) {
                logger.warn(`Limite de mensagens atingido para o grupo ${groupId} na data ${date}.`);
                return resolve(false);
            }
            db.run('INSERT INTO messages (groupId, date, message) VALUES (?, ?, ?)', [groupId, date, JSON.stringify(message)], (err) => {
                if (err) reject(err);
                else resolve(true);
            });
        });
    });
}

// Salvar conhecimento do usuário
async function saveKnowledge(userId, content) {
    const date = new Date().toISOString().split('T')[0];
    return new Promise((resolve, reject) => {
        db.run('INSERT INTO knowledge (userId, date, content) VALUES (?, ?, ?)', [userId, date, content], (err) => {
            if (err) reject(err);
            else resolve(true);
        });
    });
}

// Recuperar conhecimento do usuário
async function getKnowledge(userId) {
    return new Promise((resolve, reject) => {
        db.all('SELECT content FROM knowledge WHERE userId = ?', [userId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(row => row.content).join('\n'));
        });
    });
}

// Salvar leads de vendas
async function saveLead(userId, message) {
    const date = new Date().toISOString();
    return new Promise((resolve, reject) => {
        db.run('INSERT INTO leads (userId, date, message) VALUES (?, ?, ?)', [userId, date, message], (err) => {
            if (err) reject(err);
            else resolve(true);
        });
    });
}

// Recuperar leads de vendas
async function getLeads(userId) {
    return new Promise((resolve, reject) => {
        db.all('SELECT date, message FROM leads WHERE userId = ?', [userId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(row => `${row.date}: ${row.message}`).join('\n'));
        });
    });
}

// Marcar lead como acompanhado
async function markLeadAsFollowedUp(leadId) {
    return new Promise((resolve, reject) => {
        db.run('UPDATE leads SET followedUp = 1 WHERE id = ?', [leadId], (err) => {
            if (err) reject(err);
            else resolve(true);
        });
    });
}

// Salvar no cache
async function saveToCache(prompt, response) {
    const date = new Date().toISOString();
    return new Promise((resolve) => {
        db.run('INSERT OR REPLACE INTO cache (prompt, response, date) VALUES (?, ?, ?)', [prompt, response, date], (err) => {
            if (err) logger.warn(`Erro ao salvar no cache: ${err.message}`);
            resolve(!err);
        });
    });
}

// Recuperar do cache
async function getFromCache(prompt) {
    return new Promise((resolve) => {
        db.get('SELECT response FROM cache WHERE prompt = ?', [prompt], (err, row) => {
            if (err) logger.warn(`Erro ao buscar no cache: ${err.message}`);
            resolve(row ? row.response : null);
        });
    });
}

// Salvar uso do comando
async function logUsage(userId, command) {
    const date = new Date().toISOString();
    return new Promise((resolve) => {
        db.run('INSERT INTO usage (userId, command, date) VALUES (?, ?, ?)', [userId, command, date], (err) => {
            if (err) logger.warn(`Erro ao logar uso: ${err.message}`);
            resolve(!err);
        });
    });
}

// Detectar tom da mensagem
function detectTone(text) {
    const formalWords = ["senhor", "por favor", "obrigado", "gostaria", "poderia"];
    const informalWords = ["mano", "beleza", "fala aí", "tranquilo", "e aí"];
    
    text = text.toLowerCase();
    const formalScore = formalWords.filter(word => text.includes(word)).length;
    const informalScore = informalWords.filter(word => text.includes(word)).length;

    return formalScore > informalScore ? "formal" : informalScore > formalScore ? "informal" : "neutro";
}

// Ajustar tom da resposta
function adjustTone(response, tone) {
    if (tone === "formal") {
        return response.replace(/mano/g, "senhor(a)")
                      .replace(/beleza/g, "ótimo")
                      .replace(/😎/g, "🙂")
                      .replace(/putz/g, "desculpe-me");
    } else if (tone === "informal") {
        return response.replace(/senhor(a)/g, "mano")
                      .replace(/ótimo/g, "beleza")
                      .replace(/🙂/g, "😎")
                      .replace(/desculpe-me/g, "putz");
    }
    return response;
}

// Encontrar produto relevante
function findRelevantProduct(text) {
    const textLower = text.toLowerCase();
    for (const [name, product] of Object.entries(products)) {
        if (product.keywords.some(keyword => textLower.includes(keyword))) {
            return { name, ...product };
        }
    }
    return null;
}

// Identificar campanha
function identifyCampaign(text) {
    const textLower = text.toLowerCase();
    for (const [name, product] of Object.entries(products)) {
        if (product.keywords.some(keyword => textLower.includes(keyword))) {
            return name;
        }
    }
    return null;
}

// Agendar lembretes de follow-up
function scheduleLeadFollowUps() {
    schedule.scheduleJob('*/10 * * * *', async () => {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        db.all('SELECT id, userId, message FROM leads WHERE followedUp = 0 AND date < ?', [oneHourAgo], async (err, rows) => {
            if (err) {
                logger.error('Erro ao verificar leads:', err.message);
                return;
            }
            for (const row of rows) {
                try {
                    const campaign = identifyCampaign(row.message);
                    const tone = detectTone(row.message);
                    let followUpResponse;
                    if (campaign && products[campaign].campaignMessages) {
                        followUpResponse = products[campaign].campaignMessages[tone].replace('[link]', products[campaign].link);
                    } else {
                        followUpResponse = await generateTextWithFallback(
                            `Olá! Você mencionou: "${row.message}". Responda em português, de forma breve e incentivando a compra!`,
                            row.userId
                        );
                        const product = findRelevantProduct(row.message);
                        if (product) {
                            followUpResponse += `\nAproveite e conheça o ${product.name}: ${product.description} 👉 ${product.link}`;
                        }
                    }
                    await client.sendMessage(row.userId, adjustTone(followUpResponse, tone));
                    await markLeadAsFollowedUp(row.id);
                    logger.info(`Follow-up enviado para ${row.userId}: ${followUpResponse}`);
                } catch (error) {
                    logger.error(`Erro ao enviar follow-up para ${row.userId}: ${error.message}`, error.stack);
                }
            }
        });
    });
}

// Verificação de saúde das APIs
function scheduleApiHealthCheck() {
    schedule.scheduleJob('0 * * * *', async () => {
        const reportNumber = process.env.REPORT_PHONE_NUMBER;
        if (!reportNumber) {
            logger.warn('REPORT_PHONE_NUMBER não configurado. Pulando verificação de saúde das APIs.');
            return;
        }
        if (apiFailureCount.size > 0) {
            let alertMessage = '🚨 Alerta de APIs:\n';
            apiFailureCount.forEach((count, api) => {
                if (count >= 5) {
                    alertMessage += `${api}: ${count} falhas na última hora\n`;
                }
            });
            if (alertMessage !== '🚨 Alerta de APIs:\n') {
                await client.sendMessage(reportNumber, alertMessage);
                logger.info('Alerta de falhas de API enviado.');
            }
            apiFailureCount.clear();
        }
    });
}

// Manipulador de mensagens
client.on('message', async (message) => {
    if (message.fromMe) {
        logger.info('Mensagem ignorada: Enviada pelo próprio bot.');
        return;
    }

    try {
        logger.info(`Mensagem recebida: "${message.body}" de ${message.from} (Grupo: ${message.isGroupMsg})`);
        const text = message.body.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const userId = message.from;
        const now = Date.now();

        if (rateLimitMap.has(userId) && (now - rateLimitMap.get(userId)) < config.rateLimitMs) {
            logger.info(`Limite de taxa atingido para ${userId}`);
            return;
        }
        rateLimitMap.set(userId, now);
        metrics.logMessage();

        const context = conversationContext.get(userId) || [];

        if (message.isGroupMsg || message.from.includes('@g.us')) {
            if (text.startsWith('!')) {
                const commandParts = text.slice(1).split(' ');
                const command = commandParts[0];
                const commandContent = commandParts.slice(1).join(' ').trim();
                if (commandContent && command !== 'conhecimento' && command !== 'leads') {
                    context.push({ role: 'user', content: commandContent });
                    if (context.length > 10) context.shift();
                    conversationContext.set(userId, context);
                }
                await logUsage(userId, command);
                await handleCommand(text, message);
            } else {
                logger.info(`Mensagem não é comando, ignorada em grupo: "${message.body}" de ${message.from}`);
            }
            return;
        }

        if (text.startsWith('!')) {
            const commandParts = text.slice(1).split(' ');
            const command = commandParts[0];
            const commandContent = commandParts.slice(1).join(' ').trim();
            if (commandContent && command !== 'conhecimento' && command !== 'leads') {
                context.push({ role: 'user', content: commandContent });
                if (context.length > 10) context.shift();
                conversationContext.set(userId, context);
            }
            await logUsage(userId, command);
            await handleCommand(text, message);
            return;
        }

        context.push({ role: 'user', content: text });
        if (context.length > 10) context.shift();
        conversationContext.set(userId, context);

        if (text.includes('venda') || text.includes('compra') || text.includes('vendido') || text.includes('comprado')) {
            metrics.incrementSales();
            logger.info(`Intenção de venda detectada na mensagem: ${text}`);
            await saveLead(userId, text);
            const recoveryResponse = await generateTextWithFallback(
                `Olá! Você mencionou: "${text}". Responda em português, de forma breve e incentivando a compra!`,
                userId
            );
            await message.reply(adjustTone(recoveryResponse, detectTone(message.body)));
            return;
        }

        if (config.autoReply) {
            await intelligentResponseHandler(message, context);
        }
    } catch (error) {
        logger.error(`Erro ao processar mensagem de ${message.from}: ${error.message}`, error.stack);
        await message.reply('Desculpe-me, ocorreu um erro. Poderia tentar novamente? 🙂');
    }
});

// Manipulador de comandos
async function handleCommand(text, message) {
    const [command, ...args] = text.slice(1).split(' ');
    const model = args[0]?.toLowerCase();
    const prompt = (['mixtral', 'gemma', 'falcon', 'grokking', 'grok', 'openai', 'together', 'cohere', 'gemini'].includes(model) ? args.slice(1) : args).join(' ');
    metrics.logCommand();

    switch (command.toLowerCase()) {
        case 'ajuda':
            await showHelp(message);
            break;
        case 'cancelar':
            await message.reply('Cancelamento realizado com sucesso! Como posso ajudá-lo agora? 🙂');
            break;
        case 'gerartexto':
            if (!prompt) {
                await message.reply('Olá! Por favor, forneça um texto para gerar, como: "!gerartexto together Escreva um poema".');
                return;
            }
            let generatedText;
            try {
                if (model === 'mixtral') {
                    generatedText = await withRetry(() => generateTextWithMixtral(prompt));
                } else if (model === 'gemma') {
                    generatedText = await withRetry(() => generateTextWithGemma(prompt));
                } else if (model === 'falcon') {
                    generatedText = await withRetry(() => generateTextWithFalcon(prompt));
                } else if (model === 'grokking') {
                    generatedText = await withRetry(() => generateTextWithGrokking(prompt));
                } else if (model === 'grok') {
                    generatedText = await withRetry(() => generateTextWithGrok(prompt));
                } else if (model === 'openai') {
                    generatedText = await withRetry(() => generateTextWithOpenAI(prompt));
                } else if (model === 'together') {
                    generatedText = await withRetry(() => generateTextWithTogether(prompt));
                } else if (model === 'cohere') {
                    generatedText = await withRetry(() => generateTextWithCohere(prompt));
                } else if (model === 'gemini') {
                    generatedText = await withRetry(() => generateTextWithGemini(prompt));
                } else {
                    generatedText = await generateTextWithFallback(prompt, message.from);
                }
                await saveToCache(prompt, generatedText);
                await message.reply(`Aqui está o texto gerado: ${generatedText} 🙂`);
            } catch (error) {
                logger.error(`Erro ao gerar texto: ${error.message}`, error.stack);
                await message.reply('Desculpe-me, ocorreu um erro ao gerar o texto. Tente novamente com "!gerartexto [modelo] [prompt]".');
            }
            break;
        case 'gerarimagem':
            if (!prompt) {
                await message.reply('Olá! Por favor, indique o que deseja gerar, como: "!gerarimagem Um gato astronauta".');
                return;
            }
            try {
                await message.reply('Aguarde um momento enquanto gero a imagem... 🖼️');
                const imageUrl = await generateImageWithOpenAI(prompt);
                await client.sendMessage(message.from, { media: imageUrl, caption: 'Aqui está sua imagem! Espero que goste! 🙂' });
            } catch (error) {
                logger.error(`Erro ao gerar imagem: ${error.message}`, error.stack);
                await message.reply('Desculpe-me, não consegui gerar a imagem. Poderia tentar novamente?');
            }
            break;
        case 'buscarx':
            if (!prompt) {
                await message.reply('Olá! Por favor, indique o que deseja buscar no X, como: "!buscarx tecnologia".');
                return;
            }
            try {
                const xResult = await searchX(prompt);
                await message.reply(`Resultado da busca no X: ${xResult} 😊`);
            } catch (error) {
                logger.error(`Erro ao buscar no X: ${error.message}`, error.stack);
                await message.reply('Desculpe-me, não consegui realizar a busca no X. Tente novamente mais tarde.');
            }
            break;
        case 'perfilx':
            if (!prompt) {
                await message.reply('Olá! Por favor, forneça um usuário do X para analisar, como: "!perfilx elonmusk".');
                return;
            }
            try {
                const profileAnalysis = await analyzeXProfile(prompt);
                await message.reply(`Análise do perfil @${prompt}: ${profileAnalysis} 😉`);
            } catch (error) {
                logger.error(`Erro ao analisar perfil do X: ${error.message}`, error.stack);
                await message.reply('Desculpe-me, não consegui analisar o perfil no X. Tente outro usuário.');
            }
            break;
        case 'buscar':
            if (!prompt) {
                await message.reply('Olá! Por favor, indique o que deseja buscar, como: "!buscar inteligência artificial".');
                return;
            }
            try {
                const searchResult = await searchGoogle(prompt);
                await message.reply(`Resultado da busca: ${searchResult} 🙂`);
            } catch (error) {
                logger.error(`Erro ao buscar com Google: ${error.message}`, error.stack);
                await message.reply('Desculpe-me, a busca não foi concluída. Tente novamente ou use "!buscarx".');
            }
            break;
        case 'clima':
            if (!prompt) {
                await message.reply('Olá! Por favor, indique a cidade, como: "!clima São Paulo".');
                return;
            }
            try {
                const weather = await getWeather(prompt);
                await message.reply(`${weather} 🌤️`);
            } catch (error) {
                logger.error(`Erro ao consultar clima: ${error.message}`, error.stack);
                await message.reply('Desculpe-me, não consegui verificar o clima. Tente outra cidade.');
            }
            break;
        case 'traduzir':
            if (!prompt) {
                await message.reply('Olá! Por favor, indique o texto a traduzir, como: "!traduzir Olá para inglês".');
                return;
            }
            try {
                const translatedText = await withRetry(() => translateText(prompt, 'en'));
                await message.reply(`Aqui está a tradução: ${translatedText} 😊`);
            } catch (error) {
                logger.error(`Erro ao traduzir texto: ${error.message}`, error.stack);
                await message.reply('Desculpe-me, não consegui traduzir o texto. Tente novamente.');
            }
            break;
        case 'resumo':
            try {
                const summary = await generateDailySummary(GROUP_ID);
                await message.reply(`${summary} 📝`);
            } catch (error) {
                logger.error(`Erro ao gerar resumo: ${error.message}`, error.stack);
                await message.reply('Desculpe-me, não consegui gerar o resumo.');
            }
            break;
        case 'status':
            const uptime = Math.floor((Date.now() - startTime) / 1000 / 60);
            await message.reply(`Estou ativo há ${uptime} minutos. Mensagens: ${metrics.getMessageCount()}. Comandos: ${metrics.getCommandCount()}. Vendas: ${metrics.getTotalSales()}. Como posso ajudá-lo? 🙂`);
            break;
        case 'config':
            if (!args.length) {
                await message.reply(`Configurações atuais: ${JSON.stringify(config, null, 2)}`);
                return;
            }
            const [key, value] = args;
            if (key in defaultConfig) {
                config[key] = value === 'true' || value === 'false' ? value === 'true' : value;
                try {
                    fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
                    await message.reply(`Configuração atualizada: ${key} = ${value} 👍`);
                } catch (error) {
                    logger.error(`Erro ao salvar config.json: ${error.message}`, error.stack);
                    await message.reply('Desculpe-me, não consegui atualizar a configuração.');
                }
            } else {
                await message.reply('Desculpe-me, essa configuração não é válida. Consulte o comando !ajuda.');
            }
            break;
        case 'vendas':
            await message.reply(`Registei ${metrics.getTotalSales()} intenções de venda até agora. Deseja ver os leads com !leads? 🙂`);
            break;
        case 'hora':
            const now = new Date();
            const localHours = (now.getUTCHours() + TIMEZONE_OFFSET + 24) % 24;
            const minutes = now.getUTCMinutes().toString().padStart(2, '0');
            let greeting = localHours >= 5 && localHours < 12 ? 'Bom dia' : localHours >= 12 && localHours < 18 ? 'Boa tarde' : 'Boa noite';
            await message.reply(`${greeting}! São ${localHours}:${minutes} (horário local). Como posso ajudá-lo hoje? ⏰`);
            break;
        case 'conhecimento':
            if (!prompt) {
                await message.reply('Olá! Por favor, ensine-me algo, como: "!conhecimento O melhor celular é o XPhone".');
                return;
            }
            try {
                await saveKnowledge(message.from, prompt);
                await message.reply(`Obrigado! Registrei o conhecimento: "${prompt}". Pode mandar mais ou fazer uma pergunta! 😊`);
            } catch (error) {
                logger.error(`Erro ao salvar conhecimento: ${error.message}`, error.stack);
                await message.reply('Desculpe-me, não consegui registrar o conhecimento.');
            }
            break;
        case 'leads':
            try {
                const leads = await getLeads(message.from);
                if (!leads) {
                    await message.reply('Ainda não registrei leads para você. Mentionar "venda" ou "compra" ativa o registro! 😉');
                } else {
                    await message.reply(`Aqui estão seus leads registrados:\n${leads} 📋`);
                }
            } catch (error) {
                logger.error(`Erro ao buscar leads: ${error.message}`, error.stack);
                await message.reply('Desculpe-me, não consegui buscar os leads.');
            }
            break;
        default:
            await message.reply('Desculpe-me, não reconheci esse comando. Consulte o !ajuda para mais informações.');
    }
}

// Funções de integração com APIs
async function generateTextWithMixtral(prompt) {
    try {
        const response = await axios.post(
            'https://api-inference.huggingface.co/models/mistralai/Mixtral-8x7B-Instruct-v0.1',
            { inputs: prompt, parameters: { max_new_tokens: 100 } },
            { headers: { 'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`, 'Content-Type': 'application/json' } }
        );
        return response.data[0]?.generated_text.replace(prompt, '').trim();
    } catch (error) {
        logger.error(`Erro ao chamar Mixtral API: ${error.message}`, error.stack);
        throw new Error('Erro ao gerar texto com Mixtral');
    }
}

async function generateTextWithGemma(prompt) {
    try {
        const response = await axios.post(
            'https://api-inference.huggingface.co/models/google/gemma-2-9b-it',
            { inputs: prompt, parameters: { max_new_tokens: 100 } },
            { headers: { 'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`, 'Content-Type': 'application/json' } }
        );
        return response.data[0]?.generated_text.replace(prompt, '').trim();
    } catch (error) {
        logger.error(`Erro ao chamar Gemma API: ${error.message}`, error.stack);
        throw new Error('Erro ao gerar texto com Gemma');
    }
}

async function generateTextWithFalcon(prompt) {
    try {
        const response = await axios.post(
            'https://api-inference.huggingface.co/models/tiiuae/falcon-7b-instruct',
            { inputs: prompt, parameters: { max_new_tokens: 100 } },
            { headers: { 'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`, 'Content-Type': 'application/json' } }
        );
        return response.data[0]?.generated_text.replace(prompt, '').trim();
    } catch (error) {
        logger.error(`Erro ao chamar Falcon API: ${error.message}`, error.stack);
        throw new Error('Erro ao gerar texto com Falcon');
    }
}

async function generateTextWithGrokking(prompt) {
    try {
        const response = await axios.post(
            'https://api-inference.huggingface.co/models/Grokking-Team/xAI-Grokking-Mixtral',
            { inputs: prompt, parameters: { max_new_tokens: 100 } },
            { headers: { 'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`, 'Content-Type': 'application/json' } }
        );
        return response.data[0]?.generated_text.replace(prompt, '').trim();
    } catch (error) {
        logger.error(`Erro ao chamar Grokking API: ${error.message}`, error.stack);
        throw new Error('Erro ao gerar texto com Grokking');
    }
}

async function generateTextWithGrok(prompt) {
    try {
        const response = await axios.post(
            'https://api.x.ai/v1/chat/completions',
            { 
                model: 'grok',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 100 
            },
            { headers: { 'Authorization': `Bearer ${process.env.GROK_API_KEY}`, 'Content-Type': 'application/json' } }
        );
        return response.data.choices[0].message.content;
    } catch (error) {
        logger.error(`Erro ao chamar Grok API: ${error.message}`, error.stack);
        throw new Error('Erro ao gerar texto com Grok');
    }
}

async function generateTextWithOpenAI(prompt) {
    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            { 
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 100 
            },
            { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' } }
        );
        return response.data.choices[0].message.content;
    } catch (error) {
        logger.error(`Erro ao chamar OpenAI API: ${error.message}`, error.stack);
        throw new Error('Erro ao gerar texto com OpenAI');
    }
}

async function generateTextWithTogether(prompt) {
    try {
        const response = await axios.post(
            'https://api.together.xyz/v1/chat/completions',
            {
                model: 'mistralai/Mixtral-8x7B-Instruct-v0.1',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 100,
                temperature: 0.7,
            },
            { headers: { 'Authorization': `Bearer ${process.env.TOGETHER_API_KEY}`, 'Content-Type': 'application/json' } }
        );
        return response.data.choices[0].message.content;
    } catch (error) {
        logger.error(`Erro ao chamar Together API: ${error.message}`, error.stack);
        throw new Error('Erro ao gerar texto com Together');
    }
}

async function generateTextWithCohere(prompt) {
    try {
        const response = await axios.post(
            'https://api.cohere.ai/v1/generate',
            {
                model: 'command',
                prompt: prompt,
                max_tokens: 100,
                temperature: 0.7,
            },
            { headers: { 'Authorization': `Bearer ${process.env.COHERE_API_KEY}`, 'Content-Type': 'application/json' } }
        );
        return response.data.generations[0].text.trim();
    } catch (error) {
        logger.error(`Erro ao chamar Cohere API: ${error.message}`, error.stack);
        throw new Error('Erro ao gerar texto com Cohere');
    }
}

async function generateTextWithGemini(prompt) {
    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { maxOutputTokens: 100 },
            },
            { headers: { 'Content-Type': 'application/json' } }
        );
        return response.data.candidates[0].content.parts[0].text;
    } catch (error) {
        logger.error(`Erro ao chamar Gemini API: ${error.message}`, error.stack);
        throw new Error('Erro ao gerar texto com Gemini');
    }
}

async function generateImageWithOpenAI(prompt) {
    try {
        const response = await axios.post(
            'https://api.openai.com/v1/images/generations',
            { 
                prompt: prompt,
                n: 1,
                size: '512x512'
            },
            { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' } }
        );
        return response.data.data[0].url;
    } catch (error) {
        logger.error(`Erro ao gerar imagem com OpenAI: ${error.message}`, error.stack);
        throw new Error('Erro ao gerar imagem com OpenAI');
    }
}

async function detectLanguage(text) {
    try {
        const response = await axios.post(
            'https://api-inference.huggingface.co/models/papluca/xlm-roberta-base-language-detection',
            { inputs: text },
            { headers: { 'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`, 'Content-Type': 'application/json' } }
        );
        return response.data[0][0].label;
    } catch (error) {
        logger.warn(`Erro na detecção de idioma: ${error.message}`, error.stack);
        return 'pt';
    }
}

async function searchX(query) {
    return `Resultados simulados do X para "${query}": "Post interessante sobre ${query}!"`; // Placeholder
}

async function analyzeXProfile(username) {
    try {
        return `Perfil @${username}: Usuário ativo, frequentemente aborda temas de tecnologia e inovação.`; // Placeholder
    } catch (error) {
        logger.error(`Erro ao analisar perfil do X: ${error.message}`, error.stack);
        throw new Error('Erro ao analisar perfil');
    }
}

async function getWeather(city) {
    if (!process.env.OPENWEATHERMAP_API_KEY) return 'Olá! Não possuo a chave necessária para consultar o clima.';
    try {
        const response = await axios.get(
            `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${process.env.OPENWEATHERMAP_API_KEY}&units=metric&lang=pt_br`
        );
        const { main, weather } = response.data;
        return `Clima em ${city}: ${weather[0].description}, ${main.temp}°C, sensação térmica de ${main.feels_like}°C. 🌤️`;
    } catch (error) {
        logger.error(`Erro ao consultar clima: ${error.message}`, error.stack);
        return 'Não consegui encontrar o clima para essa cidade. Tente outra, por favor.';
    }
}

async function analyzeSentiment(text) {
    try {
        const response = await axios.post(
            'https://api-inference.huggingface.co/models/distilbert-base-uncased-finetuned-sst-2-english',
            { inputs: text },
            { headers: { 'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`, 'Content-Type': 'application/json' } }
        );
        const result = response.data[0];
        return result[0].label === 'POSITIVE' ? 'positivo' : result[0].label === 'NEGATIVE' ? 'negativo' : 'neutro';
    } catch (error) {
        logger.warn(`Erro na análise de sentimento: ${error.message}`, error.stack);
        return 'neutro';
    }
}

async function searchGoogle(query) {
    if (!process.env.GOOGLE_API_KEY || !process.env.GOOGLE_CX) {
        logger.warn('Chaves do Google Custom Search não configuradas no .env');
        return 'Olá! Não possuo as chaves necessárias para buscar no Google. Experimente "!buscarx" para buscar no X.';
    }
    try {
        const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
            params: {
                key: process.env.GOOGLE_API_KEY,
                cx: process.env.GOOGLE_CX,
                q: query,
                num: 1,
            }
        });
        const item = response.data.items[0];
        return `${item.title}: ${item.snippet} (${item.link})`;
    } catch (error) {
        logger.error(`Erro na busca do Google: ${error.message}`, error.stack);
        return await searchWeb(query);
    }
}

async function searchWeb(query) {
    if (!process.env.SERPAPI_KEY) return 'No momento, não tenho acesso à web além do Google.';
    try {
        const response = await axios.get('https://serpapi.com/search', {
            params: {
                q: query,
                api_key: process.env.SERPAPI_KEY,
                num: 1
            }
        });
        return response.data.organic_results[0]?.snippet || 'Não encontrei informações relevantes na web.';
    } catch (error) {
        logger.error(`Erro na pesquisa web com SerpAPI: ${error.message}`, error.stack);
        return 'Não consegui realizar a busca na web no momento.';
    }
}

async function translateText(text, targetLang) {
    try {
        const response = await axios.post(
            'https://api.deepai.org/api/text-translator',
            { text: text, target_lang: targetLang },
            { headers: { 'api-key': process.env.DEEPAI_API_KEY, 'Content-Type': 'application/json' } }
        );
        return response.data.output;
    } catch (error) {
        logger.error(`Erro na tradução com DeepAI: ${error.message}`, error.stack);
        return 'Erro na tradução.';
    }
}

async function transcribeAudio(message) {
    if (!deepgram) return 'Erro: Deepgram API não configurada.';
    try {
        const media = await message.downloadMedia();
        const audioBuffer = Buffer.from(media.data, 'base64');
        const response = await deepgram.listen.prerecorded.transcribe(
            { buffer: audioBuffer, mimetype: media.mimetype },
            { punctuate: true, language: 'pt-BR' }
        );
        return response.results?.channels[0]?.alternatives[0]?.transcript || 'Sem transcrição disponível.';
    } catch (error) {
        logger.error(`Erro na transcrição com Deepgram: ${error.message}`, error.stack);
        return 'Erro ao transcrever o áudio.';
    }
}

async function analyzeImageWithGoogleVision(message) {
    if (!visionClient) return 'Erro: Google Vision API não configurada.';
    try {
        const media = await message.downloadMedia();
        const imageBuffer = Buffer.from(media.data, 'base64');
        const [result] = await visionClient.labelDetection(imageBuffer);
        const labels = result.labelAnnotations.map(label => label.description).join(', ');
        return labels ? `Rótulos detectados: ${labels}` : 'Nenhum rótulo detectado.';
    } catch (error) {
        logger.error(`Erro na análise de imagem com Google Vision: ${error.message}`, error.stack);
        return 'Erro ao analisar a imagem.';
    }
}

async function extractTextFromPDF(message) {
    try {
        const media = await message.downloadMedia();
        const pdfBuffer = Buffer.from(media.data, 'base64');
        const data = await PDFParser(pdfBuffer);
        return data.text || 'Nenhum texto extraído.';
    } catch (error) {
        logger.error(`Erro na extração de texto do PDF: ${error.message}`, error.stack);
        return 'Erro ao extrair texto do PDF.';
    }
}

async function generateDailySummary(groupId) {
    const date = new Date().toISOString().split('T')[0];
    return new Promise((resolve) => {
        db.all('SELECT message FROM messages WHERE groupId = ? AND date = ?', [groupId, date], (err, rows) => {
            if (err) {
                logger.error('Erro ao gerar resumo:', err.message);
                resolve('Erro ao gerar o resumo.');
            } else if (rows.length === 0) {
                resolve('Nenhuma mensagem registrada hoje.');
            } else {
                const messages = rows.map(row => JSON.parse(row.message).body).join('\n');
                resolve(`Resumo do dia ${date}:\n${messages.slice(0, 1000)}...`);
            }
        });
    });
}

function scheduleDailyReport() {
    const reportNumber = process.env.REPORT_PHONE_NUMBER;
    if (!reportNumber) {
        logger.warn('REPORT_PHONE_NUMBER não configurado. Relatórios diários desativados.');
        return;
    }
    schedule.scheduleJob(config.reportTime, async () => {
        try {
            const date = new Date().toISOString().split('T')[0];
            const summary = await generateDailySummary(GROUP_ID);
            await client.sendMessage(reportNumber, `Relatório diário ${date}:\n${summary}`);
            logger.info('Relatório diário enviado para', reportNumber);
        } catch (error) {
            logger.error(`Erro ao enviar relatório diário: ${error.message}`, error.stack);
        }
    });
}

// Função de resposta inteligente (placeholder, ajuste conforme necessário)
async function intelligentResponseHandler(message, context) {
    const randomResponse = simpleResponses[Math.floor(Math.random() * simpleResponses.length)];
    await message.reply(randomResponse);
}

// Função de fallback para geração de texto
async function generateTextWithFallback(prompt, userId) {
    try {
        const cachedResponse = await getFromCache(prompt);
        if (cachedResponse) return cachedResponse;
        return await withRetry(() => generateTextWithGrok(prompt));
    } catch (error) {
        logger.error(`Erro no fallback de texto para ${userId}: ${error.message}`, error.stack);
        return "Olá! Não consegui gerar uma resposta no momento, mas estou aqui para ajudar!";
    }
}

// Função de ajuda
async function showHelp(message) {
    const helpText = `
Comandos disponíveis:
!ajuda - Mostra esta mensagem
!cancelar - Cancela a operação atual
!gerartexto [modelo] [texto] - Gera texto com IA (ex.: !gerartexto grok Olá)
!gerarimagem [descrição] - Gera uma imagem
!buscarx [termo] - Busca no X
!perfilx [usuário] - Analisa perfil do X
!buscar [termo] - Busca no Google
!clima [cidade] - Consulta o clima
!traduzir [texto] - Traduz para inglês
!resumo - Resumo diário do grupo
!status - Status do bot
!config [chave] [valor] - Altera configurações
!vendas - Mostra intenções de venda
!hora - Mostra a hora local
!conhecimento [texto] - Ensina algo ao bot
!leads - Mostra leads registrados
    `;
    await message.reply(helpText);
}

// Inicialização do servidor Express
const port = process.env.PORT || 3000;
app.listen(port, () => {
    logger.info(`Servidor Express rodando na porta ${port}`);
});

client.initialize().catch((err) => {
    logger.error('Erro ao inicializar o cliente WhatsApp:', err.message, err.stack);
    console.error('Detalhes completos do erro:', JSON.stringify(err, null, 2));
});