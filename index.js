const { WebSocketServer } = require('ws');
const cors = require('cors');
const express = require('express');
const { createServer } = require('http');
const EzugiAdapter = require('./src/adapters/ezugi.adapter');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: '*',
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.use(express.json());

app.get('/api/hello', (req, res) => {
  res.json({
    mensaje: "probando servidor"
  });
});

const server = createServer(app);

const wss = new WebSocketServer({ server });

console.log("🚀 WebSocket Server inicializado");

const clientes = new Set();


function broadcast(payload) {

  const message = JSON.stringify(payload);

  clientes.forEach((cliente) => {

    if (cliente.readyState === 1) {

      cliente.send(message);
    }
  });
}

const ezugi = new EzugiAdapter((normalizedMessage) => {

  console.log('📩 provider message');
  broadcast({
    event: 'casino_data',
    data: normalizedMessage
  });
});

ezugi.connect();

wss.on('connection', (ws) => {

  clientes.add(ws);

  console.log(`👤 Cliente conectado. Total: ${clientes.size}`);

  ws.on('close', () => {

    clientes.delete(ws);

    console.log(`❌ Cliente desconectado. Total: ${clientes.size}`);
  });
});

server.listen(PORT, () => {

  console.log(`🚀 Server listo puerto ${PORT}`);
});