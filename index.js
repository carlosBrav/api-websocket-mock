const { WebSocketServer } = require('ws');
const cors = require('cors');
const express = require('express');
const app = express();
const {createServer} = require('http')

const PORT = process.env.PORT || 3000;
const whiteList = [
  'http://localhost:5173',
  'https://effervescent-sundae-bbbab3.netlify.app'
];

app.use(cors({
  origin: '*',
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
})); // permite todos los orígenes
app.use(express.json());

app.get('/api/hello',(req,res)=>{
  res.json({mensaje:"probando servidor"
           })
})

const server = createServer(app)

const wss = new WebSocketServer({ port: 3000 });
console.log("🚀 Servidor WebSocket de producción/prueba corriendo en ws://localhost:3000");

// Mantenemos un registro de todos los clientes conectados
const clientes = new Set();

wss.on('connection', (ws) => {
  clientes.add(ws);
  console.log(`👤 Cliente conectado. Total conectados: ${clientes.size}`);

  // Simulación del comportamiento: ws.on("recibir_informacion")
  ws.on('message', (message) => {
    try {
      const paquete = JSON.parse(message);

      // Validamos si el evento que viene del front es el solicitado
      if (paquete.event === "recibir_informacion") {
        console.log("📩 Evento 'recibir_informacion' capturado. Payload:", paquete.data);

        // Simulación del comportamiento: ws.send("enviar_informacion")
        // Reenviamos la información a TODOS los clientes conectados (especialmente a /user)
        const respuesta = JSON.stringify({
          event: "enviar_informacion",
          data: paquete.data
        });

        clientes.forEach((cliente) => {
          if (cliente.readyState === cliente.OPEN) {
            cliente.send(respuesta);
          }
        });
      }
    } catch (error) {
      console.error("Error al procesar el JSON recibido:", error);
    }
  });

  ws.on('close', () => {
    clientes.delete(ws);
    console.log(`❌ Cliente desconectado. Total conectados: ${clientes.size}`);
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor listo en http://localhost:${PORT}`);
  console.log('Prueba GET: http://localhost:3000/usuarios');
});
