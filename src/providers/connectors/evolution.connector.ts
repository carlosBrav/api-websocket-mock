import WebSocket from "ws";
import axios from "axios";
import dotenv from "dotenv";
import { WebSocketLogger } from "../../utils/logger-file";
import { IngestionQueue } from "../../core/services/ingestion-queue";
import { IProviderConnector } from "./base.connector";

dotenv.config();

interface EvLimits {
  min: number;
  max: number;
  currency: string;
}

interface EvSeat {
  id: number;
  occupied: boolean;
}

interface EvTable {
  id: string;
  name?: string;
  isOpen?: boolean;
  limits?: EvLimits;
  seats?: EvSeat[];
  playersCount?: number;
}

interface EvBaseMessage {
  id: string;
  type: string;
}

interface EvStateMessage extends EvBaseMessage {
  type: "state" | "State";
  tables: EvTable[] | Record<string, EvTable>; // Evolution puede enviar array o mapa indexado por tableId
}
interface EvTableAssignedMessage extends EvBaseMessage {
  type: "table_assigned" | "TableAssigned";
  table: EvTable;
}
interface EvTableUpdatedMessage extends EvBaseMessage {
  type: "table_updated" | "TableUpdated";
  table: EvTable;
}
interface EvTableClosedMessage extends EvBaseMessage {
  type: "table_closed" | "TableClosed";
  tableId: string;
}
interface EvSeatsUpdatedMessage extends EvBaseMessage {
  type: "seats_updated" | "SeatsUpdated";
  tableId: string;
  seats: EvSeat[];
}
interface EvPlayersUpdatedMessage extends EvBaseMessage {
  type: "players_updated" | "PlayersUpdated";
  tableId: string;
  playersCount: number;
}

type EvMessage =
  | EvStateMessage
  | EvTableAssignedMessage
  | EvTableUpdatedMessage
  | EvTableClosedMessage
  | EvSeatsUpdatedMessage
  | EvPlayersUpdatedMessage;

export class EvolutionConnector implements IProviderConnector {
  private ws: WebSocket | null = null;
  private isConnecting = false;
  private lastEventNr = 0;
  private loggerFile: WebSocketLogger | null = null
  private readonly ingestionQueue = new IngestionQueue();
  readonly name = 'Evolution';

  private onMessage: (payload: unknown) => void;

  private config = {
    licenseeHostname: process.env.EVOLUTION_LICENSEE_HOSTNAME || '',
    casinoId: process.env.EVOLUTION_CASINO_ID || '',
    casinoKey: process.env.EVOLUTION_CASINO_KEY || '',  // NUEVO
    apiToken: process.env.EVOLUTION_API_TOKEN || '',  // NUEVO
    currency: process.env.EVOLUTION_CURRENCY || 'COP',
    exclude: process.env.EVOLUTION_EXCLUSIONS || 'statistics',
    playerUpdates: process.env.EVOLUTION_PLAYER_UPDATES || 'true',
  };

  constructor(onMessage: (payload: unknown) => void) {

    this.loggerFile = new WebSocketLogger({ providerName: "evolution", maxMessages: 200 })
    this.onMessage = onMessage;
    if (
      !this.config.licenseeHostname ||
      !this.config.casinoId ||
      !this.config.casinoKey ||
      !this.config.apiToken
    ) {
      throw new Error('[Evolution] Faltan variables críticas en el .env (HOSTNAME, CASINO_ID, CASINO_KEY o API_TOKEN)');
    }
  }

  protected getGameProvider(): string {
    return 'evolution';
  }

  private getAuthHeader(): string {
    const key = this.config.casinoKey.trim();
    const token = this.config.apiToken.trim();
    const credentials = `${key}:${token}`;
    const base64 = `${Buffer.from(credentials, 'utf-8').toString('base64')}`
    return `Basic ${base64}`;
  }

  private getEndpoints() {
    const params = new URLSearchParams({
      gameProvider: this.getGameProvider(),
      currency: this.config.currency,
      exclude: this.config.exclude,
      //playerUpdates: this.config.playerUpdates,
    });
    const base = `https://${this.config.licenseeHostname}/api/lobby/v1/${this.config.casinoId}/live`;
    return {
      httpUrl: `${base}?${params.toString()}`,
      wsUrl: `wss://${this.config.licenseeHostname}/api/lobby/v1/${this.config.casinoId}/live?${params.toString()}`,
    };
  }

  public async fetchInitialState(): Promise<{ tables: EvTable[]; fatalError: boolean }> {
    const { httpUrl } = this.getEndpoints();
    try {
      console.log(`[HTTP] Solicitando estado base: ${httpUrl}`);
      const response = await axios.get<{ tables: EvTable[] }>(httpUrl, {
        timeout: 10000,
        headers: { Authorization: this.getAuthHeader() },
      });
      console.log("[HTTP] Conectado al http ", response?.data?.tables)
      return { tables: response.data.tables || [], fatalError: false };
    } catch (error: any) {
      // 401 = credenciales inválidas → detener reintentos, alerta crítica
      if (error.response?.status === 401) {
        console.error('[HTTP][Evolution] ALERTA CRÍTICA: Autenticación rechazada (401). Verificar EVOLUTION_CASINO_KEY y EVOLUTION_API_TOKEN. Abortando reconexión automática.');
        return { tables: [], fatalError: true }; // NO reconectar — requiere intervención manual
      }
      console.error('[HTTP][Evolution] Error obteniendo estado inicial:', error.message);
      return { tables: [], fatalError: false };
    }
  }

  public connectStreaming(): void {
    if (this.isConnecting) return;
    this.isConnecting = true;

    const { wsUrl } = this.getEndpoints();
    console.log(`[WSS] Conectando a: ${wsUrl}`);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.on("open", () => {
        console.log("[WSS] ¡Conexión establecida con éxito!");
        this.isConnecting = false;
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        try {
          let raw: string;
          if (Buffer.isBuffer(data)) {
            raw = data.toString('utf8');
          } else if (Array.isArray(data)) {
            raw = Buffer.concat(data as Buffer[]).toString('utf8');
          } else {
            raw = data.toString();
          }
          const message = JSON.parse(raw) as EvMessage;
          /*  if (message.id) {
             this.handleSequencing(message.id);
           }
  */
          //this.loggerFile?.save(message)
          this.processEvent(message);
        } catch (err: any) {
          console.error("[WSS] Error al procesar el frame:", err.message);
          this.loggerFile?.saveOnlyError(JSON.stringify({"type_message": "ERROR", "data": data}))
        }
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        this.isConnecting = false;
        const reasonStr = reason.toString();
        console.warn(`[WSS][Evolution] Conexión cerrada. Código: ${code}, Razón: ${reasonStr}`);

        if (code === 4000) {
          this.resyncAndReconnect();
        } else if (code === 4001 || reasonStr.includes('401')) {
          // Credenciales inválidas — no reintentar
          console.error('[WSS][Evolution] Autenticación rechazada (401). Revisar CASINO_KEY y API_TOKEN.');
        } else {
          this.reconnectWithBackoff();
        }
      });

      this.ws.on("error", (error: Error) => {
        console.error("[WSS] Error en el socket EVOLUTION:", error.message);
        this.ws?.close();
      });
    } catch (error: any) {
      console.error("[WSS] Error crítico abriendo la conexión:", error.message);
      this.isConnecting = false;
      this.reconnectWithBackoff();
    }
  }

  private processEvent(message: EvMessage): void {
    //console.log(`[Evolution] Evento: ${message.type} | ID: ${message.id}`);
    //console.log("MESSAGE ", message)
    switch (message.type) {
      case "state":
      case "State":
        // Evolution puede enviar tables como array o como objeto indexado por tableId
        // { "clabetstack0001": { tableId, name, ... }, ... }
        {
          const tablesRaw = message.tables;
          const tablesArray: EvTable[] = Array.isArray(tablesRaw)
            ? tablesRaw
            : Object.values(tablesRaw as Record<string, EvTable>);

          for (const table of tablesArray) {
            this.ingestionQueue.enqueue(() => this.onMessage({
              type: "table_assigned",
              id: message.id,
              table,
            }));
          }
        }
        break;

      case "table_assigned":
      case "table_updated":
      case "TableAssigned":
      case "TableUpdated":
        this.ingestionQueue.enqueue(() => this.onMessage({
          type: message.type,
          id: message.id,
          table: message.table,
        }));
        break;

      case "table_closed":
      case "TableClosed":
        this.ingestionQueue.enqueue(() => this.onMessage({ type: "table_closed", id: message.id, tableId: message.tableId }));
        break;

      case "seats_updated":
      case "SeatsUpdated":
        this.ingestionQueue.enqueue(() => this.onMessage({ type: "seats_updated", id: message.id, tableId: message.tableId, seats: message.seats }));
        break;

      case "players_updated":
      case "PlayersUpdated":
        this.ingestionQueue.enqueue(() => this.onMessage({
          type: "players_updated",
          id: message.id,
          tableId: message.tableId,
          playersCount: message.playersCount,
        }));
        break;
    }
  }

  private handleSequencing(messageId: string): void {
    const parts = messageId.split("-");
    if (parts.length >= 3) {
      const eventNr = parseInt(parts[2], 10);
      if (!isNaN(eventNr)) {
        if (this.lastEventNr > 0 && eventNr > this.lastEventNr + 1) {
          console.error(
            `[WSS] ¡GAP Detectado! Esperado: ${this.lastEventNr + 1}, Recibido: ${eventNr}. Reiniciando flujo...`,
          );
          this.ws?.close();
        } else {
          this.lastEventNr = eventNr;
        }
      }
    }
  }

  private async resyncAndReconnect(): Promise<void> {
    this.lastEventNr = 0;
    const resultMesas = await this.fetchInitialState();
    console.log(
      `[HTTP] Estado recuperado tras GAP. ${resultMesas.tables.length} mesas cacheadas.`,
    );
    this.connectStreaming();
  }

  private reconnectWithBackoff(attempt = 1): void {
    const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
    console.log(
      `[WSS] Reintentando conexión en ${delay / 1000}s... (Intento ${attempt})`,
    );

    setTimeout(() => {
      this.connectStreaming();
    }, delay);
  }

  public async start(): Promise<void> {
    this.connectStreaming();
  }

  public async dispose(): Promise<void> {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.isConnecting = false;
    this.lastEventNr = 0;
    console.log('[Evolution] Conector desconectado por inactividad.');
  }
}


