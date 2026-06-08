import WebSocket from 'ws';

export interface ClientSession {
  id: string;
  ws: WebSocket;
  isSubscribed: boolean;
  subscribedProviders: Set<number>;
  joinedAt: Date;
}

export class SessionManager {
  private sessions = new Map<string, ClientSession>();

  public addSession(id: string, ws: WebSocket): void {
    this.sessions.set(id, {
      id,
      ws,
      isSubscribed: false,
      subscribedProviders: new Set(),
      joinedAt: new Date(),
    });
  }

  public activateSubscription(id: string, providerIds: number[]): void {
    const session = this.sessions.get(id);
    if (session) {
      session.isSubscribed = true;
      session.subscribedProviders = new Set(providerIds);
      console.log(`[Session] Cliente ${id} envió mensaje. Suscripción ACTIVADA.`);
    }
  }

  public getSubscribedClientsByProvider(providerId: number): ClientSession[] {  // ← NUEVO
    return Array.from(this.sessions.values()).filter(
      s => s.isSubscribed && s.subscribedProviders.has(providerId),
    );
  }

  public removeSession(id: string): void {
    this.sessions.delete(id);
  }

  public getSubscribedClients(): ClientSession[] {
    return Array.from(this.sessions.values()).filter(s => s.isSubscribed);
  }
}