# README — Filtrado por proveedor con Adapter + Strategy

## Objetivo

Permitir que cada cliente WebSocket indique, en su mensaje inicial de suscripción,
qué proveedor(es) desea recibir. El BFF filtra el broadcast y solo entrega
al cliente los eventos que corresponden a sus proveedores solicitados.

---

## Nuevo mensaje de suscripción

El cliente debe enviar un JSON con esta estructura al conectarse:

```json
{ "token": "abc123", "provider_type": 2 }
```

También puede suscribirse a múltiples proveedores pasando un array:

```json
{ "token": "abc123", "provider_type": [1, 2, 3] }
```

| Campo           | Tipo                    | Requerido | Descripción                                      |
|-----------------|-------------------------|-----------|--------------------------------------------------|
| `token`         | `string`                | ✅        | Token de autenticación del cliente               |
| `provider_type` | `number \| number[]`    | ✅        | ID(s) del proveedor. Ver tabla de IDs abajo      |

### IDs de proveedores

| ID | Proveedor         |
|----|-------------------|
| 1  | Ezugi             |
| 2  | Evolution Gaming  |
| 3  | Pragmatic Play    |
| 4  | Playtech          |

---

## Patrones utilizados

### Strategy — `SubscriptionValidationStrategy`

Valida el mensaje de suscripción entrante. La interfaz define un contrato único;
cada estrategia concreta puede agregar lógica diferente (p.ej. validar el token
contra un servicio externo, o hacer una validación local).

```
ISubscriptionValidationStrategy
        │
        └── DefaultSubscriptionValidator   ← valida token no vacío + provider_type válido
```

### Adapter — ya existente en el proyecto

Los adapters (`EvolutionAdapter`, `PragmaticAdapter`, etc.) normalizan el payload
crudo de cada proveedor al tipo `LobbyTablePatch`, que incluye `idProveedor`.
Ese campo es la llave para el filtrado en el broadcast.

---

## Archivos nuevos / modificados

```
src/
├── core/
│   ├── models/
│   │   └── subscription.model.ts          ← NUEVO
│   └── strategies/
│       ├── subscription-validation.strategy.ts   ← NUEVO (interfaz)
│       └── default-subscription.validator.ts     ← NUEVO (implementación)
├── infrastructure/
│   └── inbound/
│       └── websocket/
│           ├── lobby.gateway.ts           ← MODIFICADO
│           └── session.manager.ts         ← MODIFICADO
└── core/
    └── services/
        └── lobby-state.manager.ts         ← MODIFICADO
```

---

## Código a implementar

### 1. `src/core/models/subscription.model.ts`

```ts
/**
 * Estructura que el cliente debe enviar como mensaje inicial de suscripción.
 */
export interface SubscriptionMessage {
  token: string;
  provider_type: number | number[];
}

/**
 * Devuelve un array normalizado de IDs de proveedor, sin importar
 * si el cliente envió un número suelto o un array.
 */
export function normalizeProviderTypes(value: number | number[]): number[] {
  return Array.isArray(value) ? value : [value];
}

/**
 * IDs de proveedor válidos que el sistema conoce.
 */
export const VALID_PROVIDER_IDS = [1, 2, 3, 4] as const;
export type ProviderId = (typeof VALID_PROVIDER_IDS)[number];
```

---

### 2. `src/core/strategies/subscription-validation.strategy.ts`

```ts
import { SubscriptionMessage } from '../models/subscription.model';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Strategy: contrato para validar el mensaje de suscripción.
 * Permite intercambiar la lógica de validación sin tocar el Gateway.
 */
export interface ISubscriptionValidationStrategy {
  validate(data: unknown): ValidationResult & { parsed?: SubscriptionMessage };
}
```

---

### 3. `src/core/strategies/default-subscription.validator.ts`

```ts
import {
  ISubscriptionValidationStrategy,
  ValidationResult,
} from './subscription-validation.strategy';
import {
  SubscriptionMessage,
  VALID_PROVIDER_IDS,
  normalizeProviderTypes,
} from '../models/subscription.model';

export class DefaultSubscriptionValidator implements ISubscriptionValidationStrategy {

  validate(data: unknown): ValidationResult & { parsed?: SubscriptionMessage } {
    // 1. Debe ser un objeto no nulo
    if (typeof data !== 'object' || data === null) {
      return { valid: false, reason: 'El mensaje debe ser un objeto JSON.' };
    }

    const msg = data as Record<string, unknown>;

    // 2. token: string no vacío
    if (typeof msg.token !== 'string' || msg.token.trim() === '') {
      return { valid: false, reason: '"token" es requerido y debe ser un string no vacío.' };
    }

    // 3. provider_type: number o array de numbers
    const pt = msg.provider_type;
    const isValidSingle = typeof pt === 'number';
    const isValidArray  = Array.isArray(pt) && pt.length > 0 && pt.every(v => typeof v === 'number');

    if (!isValidSingle && !isValidArray) {
      return {
        valid: false,
        reason: '"provider_type" debe ser un número o un array de números.',
      };
    }

    // 4. Todos los IDs deben existir en el catálogo
    const ids = normalizeProviderTypes(pt as number | number[]);
    const unknown = ids.filter(id => !(VALID_PROVIDER_IDS as readonly number[]).includes(id));

    if (unknown.length > 0) {
      return {
        valid: false,
        reason: `IDs de proveedor desconocidos: ${unknown.join(', ')}. Válidos: ${VALID_PROVIDER_IDS.join(', ')}.`,
      };
    }

    return {
      valid: true,
      parsed: {
        token: msg.token.trim(),
        provider_type: pt as number | number[],
      },
    };
  }
}
```

---

### 4. `src/infrastructure/inbound/websocket/session.manager.ts` — modificado

Se agrega `subscribedProviders: Set<number>` a la sesión y métodos para
filtrar clientes por proveedor.

```ts
import WebSocket from 'ws';

export interface ClientSession {
  id: string;
  ws: WebSocket;
  isSubscribed: boolean;
  subscribedProviders: Set<number>;   // ← NUEVO
  joinedAt: Date;
}

export class SessionManager {
  private sessions = new Map<string, ClientSession>();

  public addSession(id: string, ws: WebSocket): void {
    this.sessions.set(id, {
      id,
      ws,
      isSubscribed: false,
      subscribedProviders: new Set(),  // ← NUEVO
      joinedAt: new Date(),
    });
  }

  /**
   * Activa la suscripción y registra los IDs de proveedor solicitados.
   */
  public activateSubscription(id: string, providerIds: number[]): void {
    const session = this.sessions.get(id);
    if (session) {
      session.isSubscribed = true;
      session.subscribedProviders = new Set(providerIds);  // ← NUEVO
      console.log(`[Session] Cliente ${id} suscrito. Proveedores: [${providerIds.join(', ')}]`);
    }
  }

  public removeSession(id: string): void {
    this.sessions.delete(id);
  }

  /**
   * Retorna solo los clientes suscritos que quieren datos del proveedor dado.
   */
  public getSubscribedClientsByProvider(providerId: number): ClientSession[] {  // ← NUEVO
    return Array.from(this.sessions.values()).filter(
      s => s.isSubscribed && s.subscribedProviders.has(providerId),
    );
  }

  // Se mantiene para compatibilidad (broadcast general si se necesita)
  public getSubscribedClients(): ClientSession[] {
    return Array.from(this.sessions.values()).filter(s => s.isSubscribed);
  }
}
```

---

### 5. `src/infrastructure/inbound/websocket/lobby.gateway.ts` — modificado

Se inyecta el `ISubscriptionValidationStrategy` por constructor (Strategy),
y se usa `normalizeProviderTypes` al activar la sesión.

```ts
import { WebSocketServer, WebSocket as WSClient } from 'ws';
import { IncomingMessage } from 'http';
import { Socket } from 'net';
import crypto from 'crypto';
import { SessionManager } from './session.manager';
import { ISubscriptionValidationStrategy } from '../../../core/strategies/subscription-validation.strategy';
import { normalizeProviderTypes } from '../../../core/models/subscription.model';

export class LobbyGateway {
  private wss: WebSocketServer;

  constructor(
    private sessionManager: SessionManager,
    private validator: ISubscriptionValidationStrategy,   // ← Strategy inyectado
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

      let subscribed = false;

      ws.on('message', (raw: Buffer | string) => {
        if (subscribed) return;

        try {
          const parsed = JSON.parse(raw.toString());
          const result = this.validator.validate(parsed);  // ← Strategy en acción

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
```

---

### 6. `src/core/services/lobby-state.manager.ts` — modificado

El broadcast ahora filtra por `idProveedor` del patch usando
`getSubscribedClientsByProvider`.

```ts
import { LobbyTablePatch } from '../../domain/LobbyTablePatch';
import { SessionManager } from '../../infrastructure/inbound/websocket/session.manager';

export class LobbyStateManager {
  private currentLobbyState = new Map<string, LobbyTablePatch>();

  constructor(private sessionManager: SessionManager) {}

  public updateTableState(patch: LobbyTablePatch): void {
    // 1. Actualizar estado en memoria
    this.currentLobbyState.set(patch.external_id, patch);

    // 2. Solo clientes suscritos a este proveedor específico  ← CAMBIO CLAVE
    const targets = this.sessionManager.getSubscribedClientsByProvider(patch.idProveedor);

    if (targets.length === 0) return;

    const payloadString = JSON.stringify({ event: 'TABLE_UPDATE', data: patch });

    for (const client of targets) {
      if (client.ws.readyState === client.ws.OPEN) {
        client.ws.send(payloadString);
      }
    }
  }
}
```

---

### 7. `src/app.ts` — modificado (instanciación del validator)

```ts
import { DefaultSubscriptionValidator } from './core/strategies/default-subscription.validator';

// ...dentro de bootstrap():
const sessionManager  = new SessionManager();
const lobbyStateManager = new LobbyStateManager(sessionManager);
const validator       = new DefaultSubscriptionValidator();   // ← Strategy
new LobbyGateway(sessionManager, validator);                  // ← inyectado
```

---

## Flujo completo con el cambio

```
Cliente envía: { "token": "abc", "provider_type": [2, 3] }
       │
       ▼
LobbyGateway
  └── validator.validate(msg)        ← Strategy
        ├── token presente y no vacío ✅
        ├── provider_type [2, 3] válido ✅
        └── normalizeProviderTypes → [2, 3]
               │
               ▼
       sessionManager.activateSubscription(clientId, [2, 3])
               │  subscribedProviders = Set{2, 3}
               ▼
       ws.send({ event: 'SUBSCRIPTION_ACK', providers: [2, 3] })

--- más tarde, llega un evento de Evolution (idProveedor: 2) ---

LobbyStateManager.updateTableState(patch)   patch.idProveedor = 2
  └── sessionManager.getSubscribedClientsByProvider(2)
        → devuelve solo clientes con Set que contiene 2
               │
               ▼
       ws.send({ event: 'TABLE_UPDATE', data: patch })   ✅ solo a ellos

--- evento de Playtech (idProveedor: 4) ---

  └── getSubscribedClientsByProvider(4)
        → este cliente no tiene 4 en su Set → no recibe nada ✅
```

---

## Respuestas del servidor al cliente

| Evento              | Cuándo                                             |
|---------------------|----------------------------------------------------|
| `SUBSCRIPTION_ACK`  | Mensaje válido, suscripción activada               |
| `BAD_REQUEST`       | token vacío, provider_type inválido o JSON roto    |
| `TABLE_UPDATE`      | Evento de un proveedor al que el cliente suscribió |

---

## Cambiar la estrategia de validación

Para cambiar la lógica (p.ej. validar el token contra un servicio externo)
solo se crea una nueva clase que implemente `ISubscriptionValidationStrategy`
y se pasa al constructor de `LobbyGateway`. Sin tocar el Gateway ni el SessionManager.

```ts
class RemoteTokenValidator implements ISubscriptionValidationStrategy {
  async validate(data: unknown) {
    // llamar a un servicio de autenticación...
  }
}

new LobbyGateway(sessionManager, new RemoteTokenValidator());
```
