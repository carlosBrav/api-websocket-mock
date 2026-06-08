import axios, { AxiosResponse } from 'axios';
import { Readable } from 'stream';
import { EventEmitter } from 'events';

interface GameStreamConfig {
  licenseeHostname: string;
  casinoKey: string;
  apiToken: string;
}

export class EvolutionGameStreamClient extends EventEmitter {
  private activeStream: Readable | null = null;
  private isRunning = false;
  private lastTransmissionId: string | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor(private config: GameStreamConfig) {
    super();
    this.validateConfig();
  }

  private validateConfig(): void {
    if (!this.config.licenseeHostname || !this.config.casinoKey || !this.config.apiToken) {
      throw new Error('[EvGameStream] Configuración de credenciales incompleta.');
    }
  }

  /**
   * Inicia la conexión persistente de streaming HTTP
   */
  public async start(startTime?: string): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    const authHeader = Buffer.from(`${this.config.casinoKey}:${this.config.apiToken}`).toString('base64');
    
    // Construcción de URL con parámetros mutuamente excluyentes
    let url = `https://${this.config.licenseeHostname}/api/streaming/game/v1/`;
    if (this.lastTransmissionId) {
      url += `?transmissionId=${encodeURIComponent(this.lastTransmissionId)}`;
    } else if (startTime) {
      url += `?startTime=${encodeURIComponent(startTime)}`;
    }

    console.log(`[EvGameStream] Iniciando conexión HTTP Streaming a: ${url}`);

    try {
      const response: AxiosResponse<Readable> = await axios({
        method: 'GET',
        url,
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Accept': 'application/json',
        },
        responseType: 'stream',
        timeout: 0, // Deshabilitar timeout para conexiones persistentes
      });

      this.activeStream = response.data;
      let buffer = '';

      this.activeStream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        
        // Procesar mensajes divididos estrictamente por \r\n
        let boundaryIndex: number;
        while ((boundaryIndex = buffer.indexOf('\r\n')) !== -1) {
          const rawMessage = buffer.substring(0, boundaryIndex).trim();
          buffer = buffer.substring(boundaryIndex + 2);

          if (rawMessage.length > 0) {
            this.handleRawMessage(rawMessage);
          } else {
            // Línea vacía: Keep-Alive recibido, se ignora de forma segura
            this.emit('heartbeat');
          }
        }
      });

      this.activeStream.on('end', () => {
        console.warn('[EvGameStream] El servidor cerró el stream HTTP de forma controlada.');
        this.handleDisconnect();
      });

      this.activeStream.on('error', (err: Error) => {
        console.error('[EvGameStream] Error en el flujo del stream HTTP:', err.message);
        this.handleDisconnect();
      });

    } catch (error: any) {
      console.error('[EvGameStream] Error al conectar al endpoint de streaming:', error.message);
      this.handleDisconnect();
    }
  }

  /**
   * Procesa y parsea el mensaje JSON individual
   */
  private handleRawMessage(rawMessage: string): void {
    try {
      const parsed = JSON.parse(rawMessage);
      
      // Actualizar el último transmissionID para permitir reanudación resiliente
      if (parsed.transmissionID) {
        this.lastTransmissionId = parsed.transmissionID;
      }

      if (parsed.messageType === 'game' && parsed.data) {
        this.emit('game_round', parsed.data);
      } else if (parsed.messageType === 'tip') {
        this.emit('player_tip', parsed.data);
      } else if (parsed.messageType === 'system') {
        this.emit('system_notification', parsed.data);
      }
    } catch (err: any) {
      console.error('[EvGameStream] Error al parsear mensaje JSON:', err.message);
    }
  }

  /**
   * Maneja la desconexión segura y programa la reconexión con Backoff Exponencial
   */
  private handleDisconnect(attempt = 1): void {
    this.cleanup();
    if (!this.isRunning) return;

    const delay = Math.min(1000 * Math.pow(2, attempt), 30000); // Máximo 30 segundos
    console.log(`[EvGameStream] Programando reconexión en ${delay / 1000}s... (Intento: ${attempt})`);

    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.start();
      } catch (err) {
        this.handleDisconnect(attempt + 1);
      }
    }, delay);
  }

  private cleanup(): void {
    if (this.activeStream) {
      this.activeStream.removeAllListeners();
      this.activeStream = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  /**
   * Detiene de forma limpia el cliente de streaming
   */
  public stop(): void {
    console.log('[EvGameStream] Deteniendo cliente de streaming de forma controlada...');
    this.isRunning = false;
    this.cleanup();
  }
}