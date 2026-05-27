const { WebSocketServer } = require('ws');
const cors = require('cors');
const express = require('express');
const { createServer } = require('http');

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

// Creamos UN SOLO servidor HTTP
const server = createServer(app);

// WebSocket montado SOBRE el mismo server HTTP
const wss = new WebSocketServer({ server });

console.log("🚀 WebSocket inicializado");

// Registro de clientes
const clientes = new Set();

wss.on('connection', (ws) => {
  clientes.add(ws);

  console.log(`👤 Cliente conectado. Total: ${clientes.size}`);

  ws.on('message', (message) => {
    try {
      const paquete = JSON.parse(message);

      if (paquete.event === "recibir_informacion") {

        console.log("📩 Payload:", paquete.data);

        const respuesta = JSON.stringify({
          event: "enviar_informacion",
          data: paquete.data
        });

        clientes.forEach((cliente) => {
          if (cliente.readyState === 1) {
            cliente.send(respuesta);
          }
        });
      }

    } catch (error) {
      console.error("❌ Error JSON:", error);
    }
  });

  ws.on('close', () => {
    clientes.delete(ws);
    console.log(`❌ Cliente desconectado. Total: ${clientes.size}`);
  });
});

// IMPORTANTE:
// usar server.listen y NO app.listen
server.listen(PORT, () => {
  console.log(`🚀 Servidor listo en puerto ${PORT}`);
});
