
import { LobbyTablePatch } from '../../domain/LobbyTablePatch';
import { SessionManager } from '../../infrastructure/inbound/websocket/session.manager';

export class LobbyStateManager {
  private currentLobbyState = new Map<string, LobbyTablePatch>();

  constructor(private sessionManager: SessionManager) {}

  public updateTableState(patch: LobbyTablePatch): void {
    this.currentLobbyState.set(patch.external_id, patch);
    //const activeSubscribers = this.sessionManager.getSubscribedClients();
    const targets = this.sessionManager.getSubscribedClientsByProvider(patch.idProveedor)
    if (targets.length === 0) return;
    const payloadString = JSON.stringify({ event: 'TABLE_UPDATE', data: patch });
    
    for (const client of targets) {
      if (client.ws.readyState === client.ws.OPEN) {
        client.ws.send(payloadString);
      }
    }
  }
}