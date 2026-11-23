const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 8080;
const API_KEY = process.env.AUTHENTICATION_API_KEY || 'LoucuraDeOfertasSecretKey2026';
const AUTH_DIR = path.join(__dirname, 'auth_info');

let sock = null;
let qrCodeData = null;
let connectionStatus = 'close';

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: ['Loucura de Ofertas', 'Chrome', '120.0.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCodeData = qr;
      console.log('⚡ [WhatsApp] Novo QR Code gerado pronto para escaneamento!');
    }

    if (connection === 'close') {
      connectionStatus = 'close';
      qrCodeData = null;
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(`❌ Conexão encerrada: ${lastDisconnect?.error}. Reconectando? ${shouldReconnect}`);
      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 3000);
      }
    } else if (connection === 'open') {
      connectionStatus = 'open';
      qrCodeData = null;
      console.log('🎉 [WhatsApp] Conectado e pronto para disparos com sucesso!');
    }
  });

  // Escuta mensagens recebidas para capturar o ID do grupo automaticamente
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      const from = msg.key?.remoteJid || '';
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
      console.log(`📩 [Msg Recebida] De: ${from} | Texto: ${text}`);
      if (from.endsWith('@g.us')) {
        console.log(`🎯 [GRUPO DETECTADO!] ID: ${from}`);
      }
    }
  });
}

// 1. Página visual para escanear QR Code no navegador
app.get('/qrcode', async (req, res) => {
  if (connectionStatus === 'open') {
    return res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:50px;background:#f0fdf4;">
        <h1 style="color:#16a34a;">✅ WhatsApp Conectado com Sucesso!</h1>
        <p style="color:#374151;">O robô já está autenticado e pronto para postar no grupo.</p>
      </body></html>
    `);
  }

  if (!qrCodeData) {
    return res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:50px;">
        <h2>Aguardando QR Code...</h2>
        <p>Atualize a página em alguns segundos.</p>
        <script>setTimeout(() => location.reload(), 3000);</script>
      </body></html>
    `);
  }

  const qrImageUrl = await QRCode.toDataURL(qrCodeData);
  res.send(`
    <html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#f8fafc;">
      <h2 style="color:#0f172a;">Escanear WhatsApp do Loucura de Ofertas</h2>
      <p style="color:#64748b;">Abra o WhatsApp no celular > Aparelhos conectados > Conectar um aparelho</p>
      <div style="margin:20px auto;display:inline-block;padding:20px;background:white;border-radius:16px;box-shadow:0 10px 25px rgba(0,0,0,0.1);">
        <img src="${qrImageUrl}" style="width:300px;height:300px;" />
      </div>
      <p style="color:#94a3b8;font-size:12px;">A página atualiza automaticamente.</p>
      <script>setTimeout(() => location.reload(), 15000);</script>
    </body></html>
  `);
});

// 2. Health check
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    whatsapp: connectionStatus,
    qrcode_available: Boolean(qrCodeData)
  });
});

// 3. Listar grupos em que o WhatsApp está presente
app.get('/groups', async (req, res) => {
  if (connectionStatus !== 'open' || !sock) {
    return res.status(503).json({ error: 'WhatsApp desconectado.' });
  }

  try {
    const chats = await sock.groupFetchAllParticipating();
    const result = Object.values(chats).map(g => ({
      id: g.id,
      name: g.subject,
      participants: g.participants ? g.participants.length : 0
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Entrar no grupo via código de convite (ex: Goc7INyE58e695xwlPTr4l)
app.post('/join-group', async (req, res) => {
  if (connectionStatus !== 'open' || !sock) {
    return res.status(503).json({ error: 'WhatsApp desconectado.' });
  }

  const { inviteCode } = req.body;
  try {
    const cleanCode = inviteCode.replace('https://chat.whatsapp.com/', '').split('?')[0].trim();
    const groupId = await sock.groupAcceptInvite(cleanCode);
    res.json({ success: true, groupId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Endpoint de Envio de Oferta (com ou sem foto)
app.post('/send-deal', async (req, res) => {
  const authHeader = req.headers['apikey'] || req.headers['authorization'];
  if (authHeader !== API_KEY) {
    return res.status(401).json({ error: 'Não autorizado. Chave API inválida.' });
  }

  if (connectionStatus !== 'open' || !sock) {
    return res.status(503).json({ error: 'WhatsApp desconectado. Escaneie o QR Code em /qrcode' });
  }

  const { groupId, text, imageUrl } = req.body;
  if (!groupId || !text) {
    return res.status(400).json({ error: 'groupId e text são obrigatórios.' });
  }

  try {
    const jid = groupId.includes('@') ? groupId : `${groupId}@g.us`;

    if (imageUrl) {
      await sock.sendMessage(jid, {
        image: { url: imageUrl },
        caption: text
      });
    } else {
      await sock.sendMessage(jid, { text });
    }

    res.json({ success: true, message: 'Oferta enviada com sucesso ao WhatsApp!' });
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    res.status(500).json({ error: error.message });
  }
});

// Inicia conexão Baileys e servidor Express
connectToWhatsApp();
app.listen(PORT, () => {
  console.log(`🚀 [Loucura WhatsApp Gateway] Rodando na porta ${PORT}`);
});
