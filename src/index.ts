import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { createServer } from 'http';
import { SessionManager } from './infrastructure/inbound/websocket/session.manager';
import { LobbyStateManager } from './core/services/lobby-state.manager';
import { LobbyGateway } from './infrastructure/inbound/websocket/lobby.gateway';
import { EvolutionConnector } from './providers/connectors/evolution.connector';
import { PragmaticConnector } from './providers/connectors/pragmatic.connector';
import { PlaytechConnector } from './providers/connectors/playtech.connector';
import { EvolutionAdapter } from './providers/adapters/evolution.adapter';
import { PragmaticAdapter } from './providers/adapters/pragmatic.adapter';
import { PlaytechAdapter } from './providers/adapters/playtech.adapter';
import { EzugiAdapter } from './providers/adapters/ezugi.adapter';
import { EzugiConnector } from './providers/connectors/ezugi.connector';
import { DefaultSubscriptionValidator } from './core/strategies/default-subscription.validator';

const PORT = parseInt(process.env.WS_PORT || '3000', 10);
//const WS_PATH = '/api/v1/lobby/realtime';

async function bootstrap() {
  console.log('Iniciando api-mesas-vivos-bff...\n');

  const app = express();
  const httpServer = createServer(app);

  const sessionManager = new SessionManager();
  const lobbyStateManager = new LobbyStateManager(sessionManager);
  const validator       = new DefaultSubscriptionValidator(); 
  const gateway = new LobbyGateway(sessionManager, validator);

  /* const { lobbyRealtimeRouter } = await import('./api/routes/lobbyRealTime');
  app.use('/api/v1', lobbyRealtimeRouter); */

  httpServer.on('upgrade', (request, socket, head) => {
    gateway.handleUpgrade(request, socket as any, head);
   /*  const url = request.url ?? '';

    if (url === WS_PATH) {
      gateway.handleUpgrade(request, socket as any, head);
    } else {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
    } */
  });

  //startEvolution(lobbyStateManager, new EvolutionAdapter());
  //startEzugi(lobbyStateManager, new EzugiAdapter());
  //startPragmatic(lobbyStateManager, new PragmaticAdapter());
  //startPlaytech(lobbyStateManager, new PlaytechAdapter());

  /*  startPragmatic(lobbyStateManager, pragmaticAdapter);
 
   startPlaytech(lobbyStateManager, playtechAdapter); */

  httpServer.listen(PORT, () => {
    console.log(`[BFF] WebSocket disponible en ws://localhost:${PORT}`);
  });
}

// ---------------------------------------------------------------------------
// Evolution Gaming — HTTP snapshot + WebSocket streaming
// ---------------------------------------------------------------------------
function startEvolution(
  lobbyStateManager: LobbyStateManager,
  adapter: EvolutionAdapter,
): void {
  try {
    const connector = new EvolutionConnector((rawPayload: unknown) => {
      const patch = adapter.normalize(rawPayload);
      if (patch) lobbyStateManager.updateTableState(patch);
    });

    /*  connector.fetchInitialState().then(({fatalError, tables}) => {
      if (fatalError) {
        console.error('[Evolution] Arranque abortado por error fatal en el snapshot HTTP. connectStreaming() no será llamado.');
        return;
      }
      console.log(`[Evolution] Snapshot inicial: ${tables.length} mesas`);
      tables.forEach((table) => {
        const patch = adapter.normalize({ type: 'table_assigned', id: 'initial', table });
        if (patch) lobbyStateManager.updateTableState(patch);
      });
      connector.connectStreaming();
    }); */
    connector.connectStreaming();
  } catch (err: any) {
    console.error('[Evolution] No se pudo iniciar:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Pragmatic Play — WebSocket streaming con suscripción DGA
// ---------------------------------------------------------------------------
function startPragmatic(
  lobbyStateManager: LobbyStateManager,
  adapter: PragmaticAdapter,
): void {
  try {
    const connector = new PragmaticConnector((rawPayload: unknown) => {
      const patch = adapter.normalize(rawPayload);
      if (patch) lobbyStateManager.updateTableState(patch);
    });

    connector.connect();
  } catch (err: any) {
    console.error('[Pragmatic] No se pudo iniciar:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Playtech — Kafka mTLS streaming
// ---------------------------------------------------------------------------
function startPlaytech(lobbyStateManager: LobbyStateManager, adapter: PlaytechAdapter): void {
  try {
    const connector = new PlaytechConnector((rawPayload: unknown) => {
      const patch = adapter.normalize(rawPayload);
      if (patch) lobbyStateManager.updateTableState(patch);
    });

    connector.fetchInitialState().then(({ tables, fatalError }) => {
      if (fatalError) {
        console.error('[Playtech] Arranque abortado por error fatal. connectKafkaStreaming() no será llamado.');
        return;
      }
      console.log(`[Playtech] Snapshot inicial: ${tables.length} mesas`);
      connector.connectKafkaStreaming();
    });

  } catch (err: any) {
    console.error('[Playtech] No se pudo iniciar:', err.message);
  }
}

function startEzugi(
  lobbyStateManager: LobbyStateManager,
  adapter: EzugiAdapter,
): void {
  try {
    const connector = new EzugiConnector((rawPayload: unknown) => {
      const patch = adapter.normalize(rawPayload);
      if (patch) lobbyStateManager.updateTableState(patch);
    });

    connector.fetchInitialState().then(({ tables, fatalError }) => {
      if (fatalError) {
        console.error('[Ezugi] Arranque abortado por error fatal en el snapshot HTTP. connectStreaming() no será llamado.');
        return;
      }
      console.log(`[Ezugi] Snapshot inicial: ${tables.length} mesas`);
      tables.forEach((table) => {
        const patch = adapter.normalize({ type: 'table_assigned', id: 'initial', table });
        if (patch) lobbyStateManager.updateTableState(patch);
      });
      connector.connectStreaming();
    });

  } catch (err: any) {
    console.error('[Ezugi] No se pudo iniciar:', err.message);
  }
}

bootstrap();
