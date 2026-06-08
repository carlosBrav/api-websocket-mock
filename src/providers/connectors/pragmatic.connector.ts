import WebSocket from 'ws';
import dotenv from 'dotenv';
import { WebSocketLogger } from '../../utils/logger-file';

// Cargar variables de entorno
dotenv.config();

// --- INTERFAZ DE CONFIGURACIÓN ---
interface PragmaticConfig {
  url: string;
  casinoId: string;
  currency: string;
  tableIds: string[];
}

// --- CLASE CONECTOR ---
export class PragmaticConnector {
  private ws: WebSocket | null = null;
  private isConnecting = false;
  private pingTimeout: NodeJS.Timeout | null = null;
   private loggerFile: WebSocketLogger| null = null

  /**
   * Callback inyectado desde app.ts.
   * Recibe el payload crudo y lo entrega al adapter → LobbyStateManager.
   */
  private onMessage: (payload: unknown) => void;

  // Parámetros de reconexión (Backoff Exponencial + Jitter)
  private baseDelay = 1000;
  private maxDelay = 30000;
  private currentAttempt = 0;

  private config: PragmaticConfig = {
    url: process.env.PRAGMATIC_DGA_URL || 'wss://dga.pragmaticplaylive.net/ws',
    casinoId: process.env.PRAGMATIC_CASINO_ID || '',
    currency: process.env.PRAGMATIC_CURRENCY || 'COP',
    tableIds: (process.env.PRAGMATIC_TABLE_IDS || '').split(','),
  };

  constructor(onMessage: (payload: unknown) => void) {
    this.loggerFile = new WebSocketLogger({providerName: "pragmatic", maxMessages: 50})
    this.onMessage = onMessage;
    if (!this.config.casinoId || this.config.tableIds.length === 0 || !this.config.tableIds[0]) {
      throw new Error('[Pragmatic] Faltan variables críticas (CASINO_ID o TABLE_IDS) en el .env');
    }
  }

  /**
   * Conecta al servidor WebSocket Seguro (WSS)
   */
  public connect(): void {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isConnecting = true;
    console.log(`[WSS] Conectando a Pragmatic DGA: ${this.config.url}`);

    this.ws = new WebSocket(this.config.url);

    this.ws.on('open', () => this.handleOpen());
    this.ws.on('message', (data: WebSocket.Data) => this.handleMessage(data));
    this.ws.on('ping', () => this.handlePing());
    this.ws.on('pong', () => this.handlePong());
    this.ws.on('error', (err: Error) => this.handleError(err));
    this.ws.on('close', (code: number, reason: string) => this.handleClose(code, reason));
  }

  /**
   * Handshake físico completado. Envía suscripción de datos.
   */
  private handleOpen(): void {
    console.log('[WSS] ¡Conexión física abierta con éxito!');
    this.isConnecting = false;
    this.currentAttempt = 0; // Resetear intentos de reconexión

    this.heartbeat();

    // Mensaje mandatorio inicial para Pragmatic DGA
    const subscriptionMessage = {
      type: 'subscribe',
      isDeltaEnabled: true,
      casinoId: this.config.casinoId,
      currency: this.config.currency,
      key: this.config.tableIds,
    };

    console.log('[WSS] Enviando payload de suscripción para el Lobby...');
    this.ws?.send(JSON.stringify(subscriptionMessage));
  }

  /**
   * Recepción y lectura de eventos del feed DGA
   */
  private handleMessage(rawData: WebSocket.Data): void {
    this.heartbeat(); // Refrescar el contador tras recibir actividad

    try {
      const messageString = rawData.toString();
      if (!messageString) return;

      const payload = JSON.parse(messageString);

      if (payload && payload.tableId) {
        //console.log(`[Pragmatic] Evento mesa: ${payload.tableId}`);
        // Pasar el payload crudo al callback para que lo normalice el adapter
        this.loggerFile?.save(payload)
        this.onMessage(payload);
      } else {
        console.log('[Pragmatic] Mensaje de sistema recibido:', payload);
      }
    } catch (error: any) {
      console.error('[WSS] Error parseando JSON entrante:', error.message);
    }
  }

  /**
   * Temporizador de Vida (Heartbeat) contra conexiones huérfanas
   */
  private heartbeat(): void {
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
    }

    // Tolerancia de 35s esperando actividad del servidor
    this.pingTimeout = setTimeout(() => {
      console.warn('[WSS] Timeout detectado (Inactividad prolongada). Forzando cierre...');
      this.terminateConnection();
    }, 35000);
  }

  private handlePing(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.pong(); // Responder con pong nativo
    }
    this.heartbeat();
  }

  private handlePong(): void {
    this.heartbeat();
  }

  private handleError(err: Error): void {
    console.error('[WSS] Error detectado en el canal:', err.message);
  }

  private handleClose(code: number, reason: string): void {
    console.warn(`[WSS][Pragmatic] Conexión cerrada. Código: ${code}, Razón: ${reason.toString()}`);
    this.isConnecting = false;
    this.ws = null;

    if (this.pingTimeout) clearTimeout(this.pingTimeout);

    const reasonStr = reason.toString();
    if (code === 4001 || code === 401 || reasonStr.includes('401') || reasonStr.includes('403') || reasonStr.includes('Unauthorized')) {
      console.error('[WSS][Pragmatic] CORTE FATAL: Autenticación rechazada. Verificar PRAGMATIC_CASINO_ID y TABLE_IDS. Sin reconexión.');
      return; // ← No llamar scheduleReconnect()
    }

    this.scheduleReconnect();
  }

  /**
   * Algoritmo de Backoff Exponencial con Jitter
   */
  private scheduleReconnect(): void {
    const delay = Math.min(
      this.baseDelay * Math.pow(2, this.currentAttempt),
      this.maxDelay
    );

    // Dispersión aleatoria (Jitter) para evitar colisiones concurrentes
    const jitter = Math.random() * 500;
    const finalDelay = delay + jitter;
    this.currentAttempt++;

    console.log(`[WSS] Agendando reconexión en ${Math.round(finalDelay) / 1000}s... (Intento: ${this.currentAttempt})`);

    setTimeout(() => {
      this.connect();
    }, finalDelay);
  }

  private terminateConnection(): void {
    if (this.ws) {
      try {
        this.ws.terminate(); // Cierre rudo e inmediato a nivel TCP
      } catch (err) { }
    }
  }
}