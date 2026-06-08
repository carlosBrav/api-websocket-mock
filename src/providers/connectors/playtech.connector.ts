import { Kafka, Consumer } from "kafkajs";
import axios from "axios";
import dotenv from "dotenv";
import fs from 'fs';
// Cargar variables de entorno
dotenv.config();

// --- INTERFACES DE TIPADO (Playtech API) ---
interface PlaytechRestTable {
  tableId: string;
  isOpen: boolean;
  seatsAvailable: number;
  limits: {
    min: number;
    currency: string;
  };
  lastUpdated: string;
}

interface PlaytechKafkaEvent {
  table_id: string;
  status: "OPEN" | "CLOSED";
  free_seats: number;
  min_bet?: number;
  currency?: string;
  timestamp: string;
}

// --- CLASE CONECTOR ---
export class PlaytechConnector {
  private kafka: Kafka | null = null;
  private consumer: Consumer | null = null;

  /**
   * Callback inyectado desde app.ts.
   * Recibe el payload crudo y lo entrega al adapter → LobbyStateManager.
   */
  private onMessage: (payload: unknown) => void;

  private config = {
    brokers: (process.env.PLAYTECH_KAFKA_BROKERS || "").split(","),
    clientId: process.env.PLAYTECH_KAFKA_CLIENT_ID || "atlanticcity_lobby_bff",
    groupId:
      process.env.PLAYTECH_KAFKA_GROUP_ID || "atlanticcity-group-live-lobby",
    topic:
      process.env.PLAYTECH_KAFKA_TOPIC ||
      "atlanticcity.eurolive.lobby.tables.v1",
    restUrl:
      process.env.PLAYTECH_REST_URL || "https://api.eurolive.playtech.com/v1",
    restToken: process.env.PLAYTECH_REST_TOKEN || "",
  };

  private sslCerts = {
    ca: fs.readFileSync('./ca.trust.certificate.crt'),
    cert: fs.readFileSync('./AtlanticCity.certificate.pem'),
    key: fs.readFileSync('./key-nopass.pem')
  };



  constructor(onMessage: (payload: unknown) => void) {
    this.onMessage = onMessage;
    if (this.config.brokers.length === 0 || !this.config.brokers[0]) {
      throw new Error(
        "[Playtech] Falta configurar los Kafka Brokers en el .env",
      );
    }
  }

  /**
   * Plano Sincrónico: Obtener fotografía estática inicial mediante API REST (HTTPS)
   */
  public async fetchInitialState(): Promise<{ tables: PlaytechRestTable[]; fatalError: boolean }> {
    try {
    const endpoint = `${this.config.restUrl}/lobby/tables`;
    console.log(`[HTTP REST][Playtech] Conectando para estado inicial a: ${endpoint}`);

    const response = await axios.get<PlaytechRestTable[]>(endpoint, {
      headers: {
        Authorization: `Bearer ${this.config.restToken}`,
        Accept: 'application/json',
      },
      timeout: 8000,
    });

    return { tables: response.data || [], fatalError: false };
  } catch (error: any) {
    const status = error.response?.status;

    if (status === 401 || status === 404) {
      console.error(`[HTTP REST][Playtech] CORTE FATAL: Error ${status}. Verificar PLAYTECH_REST_TOKEN y REST_URL. Sin reconexión.`);
      return { tables: [], fatalError: true };
    }

    console.error('[HTTP REST][Playtech] Error consultando la API:', error.message);
    return { tables: [], fatalError: false };
  }
  }

  /**
   * Plano Asincrónico: Conexión al stream de eventos mediante Apache Kafka (mTLS)
   */
  public async connectKafkaStreaming(): Promise<void> {
    try {
      console.log("[KAFKA] Configurando contexto mTLS seguro...");

      console.log("CA length:", this.sslCerts.ca.length);
      console.log("CERT length:", this.sslCerts.cert.length);
      console.log("KEY length:", this.sslCerts.key.length);
      const sslConfig = {
        rejectUnauthorized: true,
        ca: this.sslCerts.ca,
        cert: this.sslCerts.cert,
        key: this.sslCerts.key,
      };

      // Inicializar el cliente Kafka con la seguridad de transporte
      this.kafka = new Kafka({
        clientId: this.config.clientId,
        brokers: this.config.brokers,
        ssl: sslConfig,
        connectionTimeout: 10000,
        requestTimeout: 25000,
        retry: {
          initialRetryTime: 300,
          retries: 8,
        },
      });

      this.consumer = this.kafka.consumer({ groupId: this.config.groupId });

      console.log("[KAFKA] Conectando consumidor al cluster...");
      await this.consumer.connect();

      console.log(`[KAFKA] Suscribiéndose al topic: ${this.config.topic}`);
      await this.consumer.subscribe({
        topic: this.config.topic,
        fromBeginning: false,
      });

      // Loop de escucha/consumo de mensajes
      await this.consumer.run({
        eachMessage: async ({ message }) => {
          try {
            if (!message.value) return;

            const rawPayload = message.value.toString();
            const event = JSON.parse(rawPayload) as PlaytechKafkaEvent;

            console.log(`[Playtech] Evento Kafka mesa: ${event.table_id}`);
            // Pasar el payload crudo al callback para que lo normalice el adapter
            this.onMessage(event);
          } catch (err: any) {
            console.error(
              "[KAFKA] Error parseando payload de evento:",
              err.message,
            );
          }
        },
      });

      // Monitoreo de caídas del consumidor
      this.consumer.on("consumer.crash", (event) => {
        console.error(
          "[KAFKA] El consumidor sufrió un crash crítico:",
          event.payload.error,
        );
        this.reconnectWithBackoff();
      });
    } catch (error: any) {
      console.error(
        "[KAFKA] Fallo crítico al conectar con los brokers de Playtech:",
        error.message,
      );
      this.reconnectWithBackoff();
    }
  }

  private handleLiveEvent(event: PlaytechKafkaEvent): void {
    console.log(`[Playtech] Mesa: ${event.table_id} | Estado: ${event.status}`);
  }

  private reconnectWithBackoff(attempt = 1): void {
    const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
    console.log(
      `[KAFKA] Reintentando conexión de streaming en ${delay / 1000}s... (Intento: ${attempt})`,
    );

    setTimeout(async () => {
      try {
        if (this.consumer) {
          await this.consumer.disconnect().catch(() => {});
        }
        await this.connectKafkaStreaming();
      } catch (err) {
        this.reconnectWithBackoff(attempt + 1);
      }
    }, delay);
  }
}

// --- FLUJO DE EJECUCIÓN ---
/* async function main() {
  const connector = new PlaytechConnector();

  console.log("--- PASO 1: Cargando fotografía inicial (HTTP REST) ---");
  const tables = await connector.fetchInitialState();
  console.log(
    `[HTTP REST] Sincronización exitosa. Total mesas encontradas: ${tables.length}\n`,
  );

  console.log(
    "--- PASO 2: Iniciando Streaming en tiempo real (Kafka mTLS) ---",
  );
  await connector.connectKafkaStreaming();
} */
