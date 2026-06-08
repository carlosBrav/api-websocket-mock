import { WebSocketServer, WebSocket as WSClient } from 'ws';
import { SessionManager } from './session.manager';
import crypto from 'crypto';
import { IncomingMessage } from 'http';
import { Socket } from 'net';
import { ISubscriptionValidationStrategy } from '../../../core/strategies/subscription-validation.strategy';
import { normalizeProviderTypes } from '../../../core/models/subscription.model';

/* interface SubscriptionMessage {
  external_id: string;
  game_type: string;
} */

/* function isValidSubscriptionMessage(data: unknown): data is SubscriptionMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as Record<string, unknown>;
  return (
    typeof msg.external_id === 'string' && msg.external_id.trim() !== '' &&
    typeof msg.game_type === 'string' && msg.game_type.trim() !== ''
  );
} */

export class LobbyGateway {
  private wss: WebSocketServer;

  constructor(
    private sessionManager: SessionManager,
    private validator: ISubscriptionValidationStrategy,
  ) {
    this.wss = new WebSocketServer({ noServer: true });
    this.init();
  }

  public handleUpgrade(request: IncomingMessage, socket: Socket, head: Buffer): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit('connection', ws, request);
    });
  }

  private init(): void {
    console.log('[Gateway] WebSocket listo (montado sobre servidor HTTP)');

    this.wss.on('connection', (ws: WSClient) => {
      const clientId = crypto.randomUUID();
      this.sessionManager.addSession(clientId, ws);
      console.log(`[Gateway] Nuevo cliente conectado. ID: ${clientId}`);
      // Flag: todavía no ha enviado el mensaje inicial válido
      let subscribed = false;
      ws.on('message', (raw: Buffer | string) => {
        // Si ya está suscrito, ignorar mensajes posteriores (o procesarlos si se necesita)
        if (subscribed) return;

        try {
          const parsed = JSON.parse(raw.toString());
          const result = this.validator.validate(parsed);

          if (!result.valid || !result.parsed) {
            ws.send(JSON.stringify({ event: 'BAD_REQUEST', message: result.reason }));
            ws.close(1008, 'BAD_REQUEST');
            return;
          }

          const providerIds = normalizeProviderTypes(result.parsed.provider_type);

          subscribed = true;
          this.sessionManager.activateSubscription(clientId, providerIds);
          ws.send(JSON.stringify({
            event: 'SUBSCRIPTION_ACK',
            status: 'SUCCESS',
            providers: providerIds,
          }));

        } catch {
          ws.send(JSON.stringify({
            event: 'BAD_REQUEST',
            message: 'El mensaje debe ser JSON válido con token y provider_type.',
          }));
          ws.close(1008, 'BAD_REQUEST');
        }
      });

      ws.on('close', () => {
        this.sessionManager.removeSession(clientId);
        console.log(`[Gateway] Cliente ${clientId} desconectado.`);
      });
    });
  }
}