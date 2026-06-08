# Resumen de Arquitectura — api-mesas-vivos-bff

## ¿Qué es este servicio?

`api-mesas-vivos-bff` es un **Backend for Frontend (BFF)** de tiempo real para el lobby de Casino en Vivo. Su responsabilidad es conectarse a los distintos proveedores de juegos (Evolution, Ezugi, Pragmatic Play, Playtech), normalizar sus eventos heterogéneos a un formato canónico único, y redistribuir esa información en tiempo real a los clientes browser mediante un WebSocket propio.

**Stack:** Node.js + TypeScript | Express | ws | Axios | KafkaJS

---

## Arquitectura general

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Proveedores externos                          │
│                                                                      │
│  Evolution/Ezugi        Pragmatic Play          Playtech             │
│  HTTP + WSS             WSS (DGA)               REST + Kafka mTLS    │
└────────┬────────────────────┬───────────────────────┬───────────────┘
         │                    │                       │
         ▼                    ▼                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Connectors (src/providers/connectors/)           │
│                                                                      │
│  EvolutionConnector    PragmaticConnector      PlaytechConnector     │
│  EzugiConnector        (hereda Evolution)      (Kafka + REST)        │
└────────────────────────────┬─────────────────────────────────────────┘
                             │  payload crudo (unknown)
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Adapters (src/providers/adapters/)               │
│                                                                      │
│  EvolutionAdapter  EzugiAdapter  PragmaticAdapter  PlaytechAdapter   │
│                  (extienden ProviderAdapter)                         │
│                  normalize(payload) → LobbyTablePatch | null         │
└────────────────────────────┬─────────────────────────────────────────┘
                             │  LobbyTablePatch
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│              LobbyStateManager (src/core/services/)                  │
│                                                                      │
│  - Caché en memoria: Map<external_id, LobbyTablePatch>               │
│  - updateTableState(patch) → persiste + fan-out a clientes suscritos │
└────────────────────────────┬─────────────────────────────────────────┘
                             │  JSON { event: 'TABLE_UPDATE', data: patch }
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│              LobbyGateway + SessionManager                           │
│              (src/infrastructure/inbound/websocket/)                 │
│                                                                      │
│  - WebSocket server montado sobre el servidor HTTP (noServer: true)  │
│  - Clientes conectados en Map<clientId, ClientSession>               │
│  - Solo reciben datos los clientes con isSubscribed = true           │
└────────────────────────────┬─────────────────────────────────────────┘
                             │  ws://host:3000
                             ▼
                    Browser (acity-col Next.js)
```

---

## Patrón de diseño: Strategy + Callback injection

El proyecto implementa el patrón **Strategy** para el procesamiento de proveedores. Cada proveedor tiene su propio `Connector` (encargado del transporte y protocolo) y su propio `Adapter` (encargado de la normalización semántica). Ambos son intercambiables sin modificar el core del BFF.

El **Callback injection** conecta las dos capas: el `Connector` recibe en su constructor una función `onMessage` que se ejecuta cada vez que llega un evento del proveedor. Esa función está definida en `index.ts` y encadena `adapter.normalize(payload) → lobbyStateManager.updateTableState(patch)`.

```typescript
// Patrón de arranque en index.ts
const connector = new EvolutionConnector((rawPayload: unknown) => {
  const patch = adapter.normalize(rawPayload);  // Strategy: cada adapter normaliza distinto
  if (patch) lobbyStateManager.updateTableState(patch);  // Core agnóstico al proveedor
});
```

---

## Modelo canónico — `LobbyTablePatch`

Archivo: `src/domain/LobbyTablePatch.ts`

Todos los proveedores, independientemente de su protocolo y estructura de datos propia, producen este único contrato como salida. Es el "idioma común" del BFF.

```typescript
interface LobbyTablePatch {
  // Identificador único global en el BFF. Formato: "{proveedor}_{tableId}"
  // Ejemplos: "evolution_ev-bj-classic1", "ezugi_ez-rou-1", "pragmatic_227"
  external_id: string;

  // ID numérico del proveedor
  // 1 = Ezugi | 2 = Evolution | 3 = Pragmatic | 4 = Playtech
  idProveedor: number;

  // Nombre legible del proveedor
  nameProveedor?: string;

  // ID de la mesa tal como lo conoce el proveedor (sin prefijo)
  providerTableId: string;

  // Tipo de juego normalizado
  gameType: 'roulette' | 'blackjack' | 'baccarat' | 'dragon-tiger' | 'sicbo' | 'poker' | 'other';

  // Tipo de evento que originó este patch
  eventType?:
    | 'TABLE_OPENED'    // Mesa abre al público
    | 'TABLE_CLOSED'    // Mesa cierra o es desasignada
    | 'TABLE_UPDATED'   // Cambio en configuración o límites
    | 'BETTING_OPENED'  // Fase de apuestas iniciada
    | 'BETTING_CLOSED'  // Fase de apuestas cerrada
    | 'PLAYERS_UPDATED' // Cambio en conteo de jugadores
    | 'SEATS_UPDATED'   // Cambio en ocupación de asientos (Blackjack)
    | 'RESULT_UPDATED'; // Resultado de ronda disponible

  realtime: {
    isAvailable?: boolean;     // true = mesa abierta y jugable
    bettingOpen?: boolean;     // true = acepta apuestas en este momento
    minBet?: number;           // Apuesta mínima en la moneda indicada
    maxBet?: number;           // Apuesta máxima
    currency?: string;         // ISO-4217: "COP", "USD", "EUR", etc.
    playersOnline?: number;    // Jugadores activos en la mesa
    availableSeats?: number;   // Asientos libres (solo Blackjack físico)
    dealerName?: string;       // Nombre del crupier activo
    updatedAt: string;         // ISO-8601 timestamp del último cambio
  };

  lastResult?: {
    winningNumber?: number;    // Número ganador (Ruleta)
    winner?: string;           // Ganador o color (Baccarat, Ruleta)
    playerHandValue?: number;  // Valor mano del jugador (Baccarat)
    bankerHandValue?: number;  // Valor mano del banco (Baccarat)
    roundId?: number;          // ID de la ronda
  };
}
```

### Convención de `external_id` por proveedor

| Proveedor | Prefijo | Ejemplo |
|---|---|---|
| Evolution | `evolution_` | `evolution_ev-bj-classic1` |
| Ezugi | `ezugi_` | `ezugi_ez-rou-1` |
| Pragmatic | `pragmatic_` | `pragmatic_227` |
| Playtech | `playtech_` | `playtech_LiveBJ01` |

---

## Proveedores — Conectores y Adapters

### 1. Evolution Gaming

**Estado:** ✅ Activo (`startEvolution` habilitado en `index.ts`)

**Archivos:**
- `src/providers/connectors/evolution.connector.ts`
- `src/providers/adapters/evolution.adapter.ts`

**Protocolo:** Híbrido — HTTP REST (snapshot inicial) + WebSocket persistente (deltas)

**Autenticación:** HTTP Basic Auth — `Authorization: Basic Base64(casinoKey:apiToken)`

**Variables de entorno:**
```dotenv
EVOLUTION_LICENSEE_HOSTNAME=   # Hostname limpio, sin credenciales embebidas
EVOLUTION_CASINO_ID=           # ID del casino (ej: acitype000000001)
EVOLUTION_CASINO_KEY=          # casino.key del contrato de integración
EVOLUTION_API_TOKEN=           # apiToken del Data API
EVOLUTION_CURRENCY=COP         # Moneda para límites de apuesta
EVOLUTION_EXCLUSIONS=statistics,dealer  # Reduce payload ~60%
EVOLUTION_PLAYER_UPDATES=true  # Actualizaciones de conteo de jugadores
```

**Flujo de arranque:**
```
1. fetchInitialState()  →  GET https://{hostname}/api/lobby/v1/{casinoId}/live?...
   ├─ 401 / 404  →  fatalError: true  →  STOP, no conectar WebSocket
   └─ OK         →  poblar LobbyStateManager con todas las mesas
                     └─ connectStreaming()
                          WSS wss://{hostname}/api/lobby/v1/{casinoId}/live?...
                          ├─ open      → isConnecting = false
                          ├─ message   → handleSequencing() + processEvent()
                          ├─ close 4000 → resyncAndReconnect() (HTTP + WS)
                          ├─ close 4001/401 → STOP (sin reconexión)
                          └─ close otros  → reconnectWithBackoff() (máx 30s)
```

**Eventos que procesa el connector y cómo los normaliza el adapter:**

| Evento del proveedor | `eventType` en patch | Campos poblados |
|---|---|---|
| `state` (primer frame WS) | `TABLE_OPENED` / `TABLE_CLOSED` | `isAvailable`, `minBet`, `maxBet`, `currency`, `availableSeats` |
| `table_assigned` | `TABLE_OPENED` / `TABLE_CLOSED` | Igual que `state` |
| `table_updated` | `TABLE_OPENED` / `TABLE_CLOSED` | Igual, con datos actualizados de límites |
| `table_closed` | `TABLE_CLOSED` | `isAvailable: false` |
| `table_unassigned` | `TABLE_CLOSED` | `isAvailable: false` |
| `seats_updated` | `SEATS_UPDATED` | `availableSeats` (Blackjack) |
| `players_updated` | `PLAYERS_UPDATED` | `playersOnline` |
| `betting_opened` | `BETTING_OPENED` | `bettingOpen: true` |
| `result_updated` | `RESULT_UPDATED` | `lastResult.winningNumber`, `winner`, `roundId` |

**Detección de GAP de secuencia:**
Cada mensaje WS lleva un ID con formato `{casinoId}-{podId}-{eventNr}-{subEvent}`. El connector extrae el `eventNr` y si detecta un salto (`eventNr > lastEventNr + 1`) cierra el WebSocket, lo que dispara `resyncAndReconnect()` — llama HTTP para resincronizar y reconecta el WS.

---

### 2. Ezugi

**Estado:** ⏸ Inactivo (`startEzugi` comentado en `index.ts`)

**Archivos:**
- `src/providers/connectors/ezugi.connector.ts`
- `src/providers/adapters/ezugi.adapter.ts`

**Protocolo:** Idéntico a Evolution (mismo endpoint, mismas credenciales, misma infraestructura)

**Diferencia respecto a Evolution:** El query param `gameProvider=ezugi` en la URL filtra el stream en origen para recibir solo mesas de Ezugi. El `EzugiConnector` hereda todo de `EvolutionConnector` y únicamente sobreescribe `getGameProvider()`.

```typescript
export class EzugiConnector extends EvolutionConnector {
  protected override getGameProvider(): string {
    return 'ezugi'; // Filtra el stream: solo mesas Ezugi
  }
}
```

**Variables de entorno:** Las mismas que Evolution (`EVOLUTION_*`). Comparten host, credenciales y configuración.

**Eventos que procesa el adapter:**

| Evento | `eventType` | Campos poblados |
|---|---|---|
| `table_assigned` / `table_updated` | `TABLE_OPENED` / `TABLE_CLOSED` | `isAvailable`, `minBet`, `maxBet`, `currency`, `availableSeats` |
| `table_closed` | `TABLE_CLOSED` | `isAvailable: false` |
| `seats_updated` | `SEATS_UPDATED` | `availableSeats` |
| `players_updated` | `PLAYERS_UPDATED` | `playersOnline` |

**Nota:** `EzugiAdapter` no implementa `betting_opened`, `result_updated` ni `table_unassigned` (a diferencia de `EvolutionAdapter`).

---

### 3. Pragmatic Play

**Estado:** ✅ Activo (`startPragmatic` habilitado en `index.ts`)

**Archivos:**
- `src/providers/connectors/pragmatic.connector.ts`
- `src/providers/adapters/pragmatic.adapter.ts`

**Protocolo:** WebSocket puro (DGA — Data Gateway API). No tiene snapshot HTTP inicial. Requiere enviar un mensaje de suscripción tras el `open`.

**Autenticación:** Sin header de autenticación. Se identifica por `casinoId` y la lista de `tableIds` en el mensaje de suscripción inicial.

**Variables de entorno:**
```dotenv
PRAGMATIC_DGA_URL=wss://dga.pragmaticplaylive.net/ws
PRAGMATIC_CASINO_ID=          # ID del casino en Pragmatic
PRAGMATIC_CURRENCY=COP        # Moneda para límites
PRAGMATIC_TABLE_IDS=227,203,433,...  # IDs de mesas a suscribir (separadas por coma)
```

**Flujo de arranque:**
```
connect()
  └─ WebSocket abre
       └─ open → envía mensaje de suscripción:
            {
              type: "subscribe",
              isDeltaEnabled: true,
              casinoId: "...",
              currency: "COP",
              key: ["227", "203", "433", ...]
            }
       └─ message → si tiene tableId → onMessage(payload)
       └─ close con 401/403/4001/"Unauthorized" → STOP (sin reconexión)
       └─ close otros → scheduleReconnect() con backoff + jitter
       └─ ping → responde pong + resetea heartbeat (timeout 35s)
       └─ timeout 35s sin actividad → terminateConnection() → reconexión
```

**Campos que mapea el adapter desde el payload de Pragmatic:**

| Campo Pragmatic | Campo `LobbyTablePatch` | Notas |
|---|---|---|
| `tableId` | `providerTableId`, `external_id` | Siempre presente |
| `tableType` | `gameType` | `"BLACKJACK"`, `"ROULETTE"`, etc. |
| `tableOpen` | `isAvailable`, `eventType` | `true` → `TABLE_OPENED`, `false` → `TABLE_CLOSED` |
| `tableLimits.minBet` | `realtime.minBet` | |
| `currency` | `realtime.currency` | Default `EUR` si no viene |
| `availableSeats` | `realtime.availableSeats` | Solo Blackjack clásico (no `OneBJ`) |
| `gameResult[0]` | `lastResult` | Primer elemento = más reciente |
| `last20Results[0]` | `lastResult` | Alternativa para Ruleta / Mega Wheel |

---

### 4. Playtech

**Estado:** ⏸ Inactivo (`startPlaytech` comentado en `index.ts`)

**Archivos:**
- `src/providers/connectors/playtech.connector.ts`
- `src/providers/adapters/playtech.adapter.ts`

**Protocolo:** Híbrido — HTTP REST (snapshot inicial) + Apache Kafka con mTLS (streaming de eventos)

**Autenticación:**
- REST: `Authorization: Bearer {PLAYTECH_REST_TOKEN}`
- Kafka: Certificados mTLS (archivos `.pem` y `.crt` en la raíz del proyecto)

**Archivos de certificados requeridos (raíz del proyecto):**
```
ca.trust.certificate.crt       # CA raíz de Playtech
AtlanticCity.certificate.pem   # Certificado del operador
key-nopass.pem                 # Clave privada sin contraseña
```

**Variables de entorno:**
```dotenv
PLAYTECH_KAFKA_BROKERS=broker1:9093,broker2:9093,broker3:9093
PLAYTECH_KAFKA_CLIENT_ID=atlanticcity
PLAYTECH_KAFKA_GROUP_ID=atlanticcity-group-live-lobby
PLAYTECH_KAFKA_TOPIC=external-lobby-events-4740
PLAYTECH_REST_URL=https://api-eurolive.live-hub.net
PLAYTECH_REST_TOKEN=               # Bearer token para la REST API
```

**Flujo de arranque:**
```
fetchInitialState()  →  GET {REST_URL}/lobby/tables (Bearer token)
  ├─ 401 / 404  →  fatalError: true  →  STOP, no conectar Kafka
  └─ OK         →  poblar LobbyStateManager
                    └─ connectKafkaStreaming()
                         mTLS Kafka → consumer.subscribe(topic)
                         eachMessage → onMessage(event)
                         consumer.crash → reconnectWithBackoff()
```

**Campos que mapea el adapter desde el evento Kafka (`PlaytechKafkaEvent`):**

| Campo Kafka | Campo `LobbyTablePatch` |
|---|---|
| `table_id` | `providerTableId`, `external_id` |
| `status` (`"OPEN"` / `"CLOSED"`) | `isAvailable`, `eventType` |
| `free_seats` | `realtime.availableSeats` |
| `min_bet` | `realtime.minBet` |
| `currency` | `realtime.currency` |
| `timestamp` | `realtime.updatedAt` |

---

### 5. Evolution Game Stream (adicional, inactivo)

**Estado:** ⏸ Implementado pero no instanciado en `index.ts`

**Archivo:** `src/providers/connectors/evolution.stream.connector.ts`

**Propósito:** Capturar resultados de rondas de juego completadas (cartas, giros, resultados) para auditoría y enriquecimiento del lobby. Es complementario al Lobby Streaming — mientras el lobby WS entrega el estado de las mesas, este stream entrega los resultados de cada ronda resuelta.

**Protocolo:** HTTP Streaming (Chunked Transfer Encoding / SSE) sobre HTTPS. Conexión persistente delimitada por `\r\n`.

**Endpoint:** `GET https://{hostname}/api/streaming/game/v1/`

**Reanudación resiliente:** Guarda el último `transmissionId` recibido. Si se reconecta, reanuda desde ese punto usando `?transmissionId=...` en la URL, evitando pérdida de eventos.

---

## Infraestructura del WebSocket hacia clientes

### Flujo de conexión del cliente browser

```
1. Cliente abre ws://host:3000
   └─ LobbyGateway registra la sesión con isSubscribed = false
   └─ NO recibe datos todavía

2. Cliente envía mensaje JSON:
   { "external_id": "evolution_ev-bj-classic1", "game_type": "blackjack" }

3. Gateway valida el mensaje:
   ├─ JSON inválido o campos faltantes/vacíos
   │    └─ Responde: { event: "BAD_REQUEST", message: "..." }
   │    └─ close(1008, "BAD_REQUEST")
   └─ Válido
        └─ isSubscribed = true
        └─ Responde: { event: "SUBSCRIPTION_ACK", status: "SUCCESS" }
        └─ Cliente comienza a recibir actualizaciones

4. Desde ese momento, cada vez que un proveedor envía un evento:
   └─ LobbyStateManager.updateTableState(patch)
        └─ Serializa: { event: "TABLE_UPDATE", data: LobbyTablePatch }
        └─ Envía a todos los clientes con isSubscribed = true
```

### Mensaje que recibe el cliente tras suscribirse

```json
{
  "event": "TABLE_UPDATE",
  "data": {
    "external_id": "evolution_ev-bj-classic1",
    "idProveedor": 2,
    "nameProveedor": "EVOLUTION_PROVIDER",
    "providerTableId": "ev-bj-classic1",
    "gameType": "blackjack",
    "eventType": "SEATS_UPDATED",
    "realtime": {
      "availableSeats": 3,
      "updatedAt": "2026-06-05T14:30:00.000Z"
    }
  }
}
```

### Clases involucradas

**`LobbyGateway`** (`src/infrastructure/inbound/websocket/lobby.gateway.ts`)
- Crea el `WebSocketServer` en modo `noServer: true` (montado sobre el servidor HTTP).
- Maneja el upgrade HTTP → WebSocket.
- Gestiona el ciclo de vida de cada conexión: registro, validación de mensaje inicial, desconexión.
- Delega el estado de sesiones a `SessionManager`.

**`SessionManager`** (`src/infrastructure/inbound/websocket/session.manager.ts`)
- Mantiene el `Map<clientId, ClientSession>` en memoria.
- `addSession()`: registra con `isSubscribed: false`.
- `activateSubscription()`: cambia `isSubscribed: true` tras mensaje válido.
- `getSubscribedClients()`: retorna solo los clientes activos para el fan-out.

**`LobbyStateManager`** (`src/core/services/lobby-state.manager.ts`)
- Caché en memoria: `Map<external_id, LobbyTablePatch>`.
- `updateTableState(patch)`: actualiza el caché y hace fan-out inmediato a los clientes suscritos.
- Si no hay clientes suscritos, igualmente persiste el estado en el caché (los clientes que se conecten después recibirán actualizaciones desde el siguiente evento del proveedor).

---

## Estado actual de proveedores en `index.ts`

| Proveedor | Estado | Función |
|---|---|---|
| Evolution | ✅ Activo | `startEvolution()` |
| Pragmatic | ✅ Activo | `startPragmatic()` |
| Ezugi | ⏸ Comentado | `// startEzugi()` |
| Playtech | ⏸ Comentado | `// startPlaytech()` |

---

## Resiliencia por proveedor

| Proveedor | Error 401/404 | Desconexión normal | Timeout / inactividad |
|---|---|---|---|
| Evolution | STOP total, sin reintentar | Backoff exponencial (máx 30s) | Cierre del WS → backoff |
| Ezugi | STOP total (hereda Evolution) | Backoff exponencial (máx 30s) | Cierre del WS → backoff |
| Pragmatic | STOP total | Backoff exponencial + jitter aleatorio | Heartbeat: 35s sin actividad → `terminate()` → backoff |
| Playtech | STOP total en REST | Backoff exponencial en Kafka (8 reintentos) | `consumer.crash` → backoff |

---

## Estructura de carpetas relevante

```
src/
├── index.ts                          # Bootstrap y orquestación de proveedores
├── domain/
│   └── LobbyTablePatch.ts            # Contrato canónico único del BFF
├── core/
│   └── services/
│       └── lobby-state.manager.ts    # Caché in-memory + fan-out a clientes
├── infrastructure/
│   └── inbound/
│       └── websocket/
│           ├── lobby.gateway.ts      # WS server + validación de suscripción
│           └── session.manager.ts   # Gestión de sesiones de clientes
├── providers/
│   ├── connectors/                   # Transporte y protocolo por proveedor
│   │   ├── evolution.connector.ts   # HTTP + WSS (Evolution)
│   │   ├── evolution.stream.connector.ts  # HTTP Streaming (Game rounds)
│   │   ├── ezugi.connector.ts       # Hereda EvolutionConnector
│   │   ├── pragmatic.connector.ts   # WSS + DGA subscription
│   │   └── playtech.connector.ts    # REST + Kafka mTLS
│   └── adapters/                    # Normalización semántica por proveedor
│       ├── base.adapter.ts          # Clase abstracta con normalize() + now()
│       ├── evolution.adapter.ts     # Normaliza eventos de Evolution
│       ├── evolution.stream.adapter.ts  # Normaliza resultados de rondas
│       ├── ezugi.adapter.ts         # Normaliza eventos de Ezugi
│       ├── pragmatic.adapter.ts     # Normaliza eventos de Pragmatic DGA
│       └── playtech.adapter.ts      # Normaliza eventos Kafka de Playtech
└── api/
    └── routes/
        └── lobbyRealTime.ts         # Ruta HTTP 426 (actualmente comentada)
```
