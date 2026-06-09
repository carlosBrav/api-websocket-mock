import { WebSocketServer, WebSocket as WSClient } from 'ws';
import { SessionManager } from './session.manager';
import crypto from 'crypto';
import { IncomingMessage } from 'http';
import { Socket } from 'net';
import { ISubscriptionValidationStrategy } from '../../../core/strategies/subscription-validation.strategy';
import { LobbyStateManager } from '../../../core/services/lobby-state.manager';
import { ALL_PROVIDER_IDS } from '../../../core/models/subscription.model';
import { ProviderOrchestrator } from '../../../core/services/provider-orchestrator';

const MAX_CLIENTS = parseInt(process.env.MAX_WS_CLIENTS || '500', 10);
export class LobbyGateway {
  private wss: WebSocketServer;

  constructor(
    private sessionManager: SessionManager,
    private validator: ISubscriptionValidationStrategy,
    private lobbyStateManager?: LobbyStateManager,
    private orchestrator?: ProviderOrchestrator,
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
      if (this.sessionManager.getTotalSessionCount() >= MAX_CLIENTS) {
        ws.send(JSON.stringify({ event: 'REJECTED', message: 'Servidor al límite de capacidad.' }));
        ws.close(1013, 'Try Again Later');
        return;
      }
      const clientId = crypto.randomUUID();
      this.sessionManager.addSession(clientId, ws);
      console.log(`[Gateway] Nuevo cliente conectado. ID: ${clientId}`);
      let subscribed = false;
      ws.on('message', async (raw: Buffer | string) => {
        if (subscribed) return;

        try {
          const parsed = JSON.parse(raw.toString());
          const result = this.validator.validate(parsed);

          if (!result.valid || !result.parsed) {
            ws.send(JSON.stringify({ event: 'BAD_REQUEST', message: result.reason }));
            ws.close(1008, 'BAD_REQUEST');
            return;
          }

          const rawProviderIds = result.parsed.provider_type;
          const providerIds = rawProviderIds.length === 0 ? ALL_PROVIDER_IDS : rawProviderIds;

          subscribed = true;
          this.sessionManager.activateSubscription(clientId, providerIds);
          ws.send(JSON.stringify({
            event: 'SUBSCRIPTION_ACK',
            status: 'SUCCESS',
            providers: providerIds,
          }));
          this.orchestrator?.onClientConnected();

          for (const providerId of providerIds) {
            const snapshot = await this.lobbyStateManager?.getSnapshotForProvider(providerId);
            if (snapshot && snapshot.length > 0) {
              ws.send(JSON.stringify({
                event: 'LOBBY_SNAPSHOT',
                providerId,
                data: snapshot,
              }));
            }
          }

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
        if (subscribed) this.orchestrator?.onClientDisconnected();
        console.log(`[Gateway] Cliente ${clientId} desconectado.`);
      });
    });
  }
}