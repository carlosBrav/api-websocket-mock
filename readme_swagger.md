# api-mesas-vivos-bff — Documentación AsyncAPI

> BFF (Backend for Frontend) de mesas en vivo. Agrega streams de múltiples proveedores de casino en tiempo real y los expone a los clientes frontend mediante un único WebSocket.

---

## Especificación AsyncAPI 3.0.0

```yaml
asyncapi: 3.0.0

info:
  title: api-mesas-vivos-bff
  version: 1.0.0
  description: >
    BFF que agrega los streams en tiempo real de Evolution Gaming, Ezugi,
    Pragmatic Play y Playtech, y los re-emite normalizados a clientes frontend
    mediante un único canal WebSocket.

servers:
  production:
    host: api-mesas-vivos-bff.onrender.com
    protocol: wss
    description: Instancia en producción (Render)
  local:
    host: localhost:3000
    protocol: ws
    description: Entorno local de desarrollo

channels:
  lobby:
    address: /
    description: >
      Canal único WebSocket. El cliente se conecta, envía un mensaje de
      suscripción y recibe actualizaciones de mesas en tiempo real.
    messages:
      subscriptionRequest:
        $ref: '#/components/messages/SubscriptionRequest'
      subscriptionAck:
        $ref: '#/components/messages/SubscriptionAck'
      badRequest:
        $ref: '#/components/messages/BadRequest'
      tableUpdate:
        $ref: '#/components/messages/TableUpdate'
    bindings:
      ws:
        method: GET

operations:
  sendSubscription:
    action: send
    channel:
      $ref: '#/channels/lobby'
    summary: Enviar mensaje de suscripción inicial
    description: >
      Primer y único mensaje que el cliente debe enviar tras conectarse.
      Si es inválido, el servidor cierra la conexión con código 1008.
    messages:
      - $ref: '#/channels/lobby/messages/subscriptionRequest'

  receiveSubscriptionAck:
    action: receive
    channel:
      $ref: '#/channels/lobby'
    summary: Recibir confirmación de suscripción
    messages:
      - $ref: '#/channels/lobby/messages/subscriptionAck'

  receiveBadRequest:
    action: receive
    channel:
      $ref: '#/channels/lobby'
    summary: Recibir error de validación
    messages:
      - $ref: '#/channels/lobby/messages/badRequest'

  receiveTableUpdates:
    action: receive
    channel:
      $ref: '#/channels/lobby'
    summary: Recibir actualizaciones de mesas en tiempo real
    description: >
      Evento emitido cada vez que un proveedor upstream envía un cambio
      de estado de una mesa. Solo llega a los clientes suscritos al
      proveedor correspondiente (filtrado por idProveedor).
    messages:
      - $ref: '#/channels/lobby/messages/tableUpdate'

components:

  messages:

    SubscriptionRequest:
      name: SubscriptionRequest
      title: Mensaje de suscripción
      summary: Activa la recepción de actualizaciones de uno o más proveedores.
      payload:
        $ref: '#/components/schemas/SubscriptionRequestPayload'
      examples:
        - name: Suscribirse a un solo proveedor
          payload:
            token: mi-token-de-acceso
            provider_type: 2
        - name: Suscribirse a múltiples proveedores
          payload:
            token: mi-token-de-acceso
            provider_type: [1, 2, 3]

    SubscriptionAck:
      name: SubscriptionAck
      title: Confirmación de suscripción
      summary: Respuesta del servidor cuando la suscripción fue aceptada.
      payload:
        $ref: '#/components/schemas/SubscriptionAckPayload'
      examples:
        - name: ACK exitoso para Evolution y Pragmatic
          payload:
            event: SUBSCRIPTION_ACK
            status: SUCCESS
            providers: [2, 3]

    BadRequest:
      name: BadRequest
      title: Error de validación
      summary: El servidor envía este mensaje y cierra la conexión (código 1008).
      payload:
        $ref: '#/components/schemas/BadRequestPayload'
      examples:
        - name: Token faltante
          payload:
            event: BAD_REQUEST
            message: '"token" es requerido y debe ser un string no vacío.'
        - name: provider_type inválido
          payload:
            event: BAD_REQUEST
            message: 'IDs de proveedor desconocidos: 9. Válidos: 1, 2, 3, 4.'

    TableUpdate:
      name: TableUpdate
      title: Actualización de mesa en tiempo real
      payload:
        $ref: '#/components/schemas/TableUpdatePayload'
      examples:
        - name: Mesa de ruleta abierta (Evolution)
          payload:
            event: TABLE_UPDATE
            data:
              external_id: evolution_vip_roulette_01
              idProveedor: 2
              nameProveedor: EVOLUTION_PROVIDER
              providerTableId: vip_roulette_01
              gameType: roulette
              eventType: TABLE_OPENED
              realtime:
                isAvailable: true
                minBet: 10
                maxBet: 5000
                currency: COP
                updatedAt: '2026-06-08T12:00:00.000Z'
        - name: Blackjack con asientos disponibles (Ezugi)
          payload:
            event: TABLE_UPDATE
            data:
              external_id: ezugi_bj_table_42
              idProveedor: 1
              nameProveedor: EZUGI_PROVIDER
              providerTableId: bj_table_42
              gameType: blackjack
              eventType: SEATS_UPDATED
              realtime:
                isAvailable: true
                availableSeats: 3
                minBet: 5
                currency: COP
                updatedAt: '2026-06-08T12:00:01.000Z'
        - name: Resultado de ruleta (Pragmatic)
          payload:
            event: TABLE_UPDATE
            data:
              external_id: pragmatic_101
              idProveedor: 3
              nameProveedor: PRAGMATIC_PROVIDER
              providerTableId: '101'
              gameType: ROULETTE
              eventType: RESULT_UPDATED
              realtime:
                isAvailable: true
                minBet: 1
                currency: EUR
                updatedAt: '2026-06-08T12:00:02.000Z'
              lastResult:
                winningNumber: '7'
                winner: red
                roundId: abc-xyz-123

  schemas:

    SubscriptionRequestPayload:
      type: object
      required:
        - token
        - provider_type
      properties:
        token:
          type: string
          minLength: 1
          description: Token de autenticación del cliente.
          examples:
            - mi-token-de-acceso
        provider_type:
          description: |
            Proveedor(es) a los que el cliente desea suscribirse.
            Valores válidos:
            - 1 = Ezugi
            - 2 = Evolution Gaming
            - 3 = Pragmatic Play
            - 4 = Playtech
          oneOf:
            - type: integer
              enum: [1, 2, 3, 4]
              description: ID de un único proveedor.
            - type: array
              items:
                type: integer
                enum: [1, 2, 3, 4]
              minItems: 1
              description: Array de IDs de proveedores.

    SubscriptionAckPayload:
      type: object
      required:
        - event
        - status
        - providers
      properties:
        event:
          type: string
          const: SUBSCRIPTION_ACK
        status:
          type: string
          const: SUCCESS
        providers:
          type: array
          items:
            type: integer
          description: Lista de IDs de proveedores activados para este cliente.
          examples:
            - [2, 3]

    BadRequestPayload:
      type: object
      required:
        - event
        - message
      properties:
        event:
          type: string
          const: BAD_REQUEST
        message:
          type: string
          description: Descripción del error de validación.

    TableUpdatePayload:
      type: object
      required:
        - event
        - data
      properties:
        event:
          type: string
          const: TABLE_UPDATE
        data:
          $ref: '#/components/schemas/LobbyTablePatch'

    LobbyTablePatch:
      type: object
      required:
        - external_id
        - idProveedor
        - nameProveedor
        - providerTableId
        - gameType
        - realtime
      properties:
        external_id:
          type: string
          description: >
            Identificador único global de la mesa en el BFF.
            Formato: {proveedor}_{providerTableId}
          examples:
            - evolution_vip_roulette_01
        idProveedor:
          type: integer
          enum: [1, 2, 3, 4]
          description: |
            ID interno del proveedor:
            - 1 = Ezugi
            - 2 = Evolution Gaming
            - 3 = Pragmatic Play
            - 4 = Playtech
        nameProveedor:
          type: string
          description: Nombre legible del proveedor.
          examples:
            - EVOLUTION_PROVIDER
        providerTableId:
          type: string
          description: ID de la mesa tal como lo asigna el proveedor upstream.
          examples:
            - vip_roulette_01
        gameType:
          type: string
          enum:
            - roulette
            - blackjack
            - baccarat
            - dragon-tiger
            - sicbo
            - poker
            - other
          description: Tipo de juego normalizado.
        eventType:
          type: string
          enum:
            - TABLE_OPENED
            - TABLE_CLOSED
            - TABLE_UPDATED
            - BETTING_OPENED
            - BETTING_CLOSED
            - PLAYERS_UPDATED
            - SEATS_UPDATED
            - RESULT_UPDATED
          description: Tipo de evento que disparó la actualización.
        realtime:
          $ref: '#/components/schemas/RealtimeState'
        lastResult:
          $ref: '#/components/schemas/LastResult'

    RealtimeState:
      type: object
      required:
        - updatedAt
      properties:
        isAvailable:
          type: boolean
          description: Si la mesa está activa y aceptando jugadores.
        bettingOpen:
          type: boolean
          description: Si el periodo de apuestas está activo.
        minBet:
          type: number
          description: Apuesta mínima en la moneda indicada.
          examples:
            - 10
        maxBet:
          type: number
          description: Apuesta máxima.
          examples:
            - 5000
        currency:
          type: string
          description: Código ISO 4217 de la moneda.
          examples:
            - COP
        playersOnline:
          type: integer
          description: Número de jugadores actualmente en la mesa.
          examples:
            - 12
        availableSeats:
          type: integer
          description: Asientos físicos libres (solo Blackjack clásico).
          examples:
            - 3
        dealerName:
          type: string
          description: Nombre del dealer activo.
        updatedAt:
          type: string
          format: date-time
          description: ISO 8601 timestamp de la última actualización.
          examples:
            - '2026-06-08T12:00:00.000Z'

    LastResult:
      type: object
      description: Último resultado de la ronda. Presente solo en eventos RESULT_UPDATED.
      properties:
        winningNumber:
          type: string
          description: Número ganador (ruleta) o resultado equivalente.
          examples:
            - '7'
        winner:
          type: string
          description: >
            Ganador o color ganador. En ruleta: red/black/green.
            En baccarat: player/banker/tie.
          examples:
            - red
        playerHandValue:
          type: integer
          description: Valor de la mano del jugador (baccarat/blackjack).
        bankerHandValue:
          type: integer
          description: Valor de la mano del banco (baccarat).
        roundId:
          type: string
          description: Identificador único de la ronda.
          examples:
            - abc-xyz-123
```

---

## Guía de integración para el frontend

### 1. Conectar al servidor

```js
const ws = new WebSocket('wss://tu-host:3000');
```

### 2. Enviar suscripción al conectarse

```js
ws.onopen = () => {
  ws.send(JSON.stringify({
    token: 'mi-token-de-acceso',
    provider_type: [1, 2, 3, 4] // todos los proveedores
  }));
};
```

### 3. Manejar respuestas del servidor

```js
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  switch (message.event) {

    case 'SUBSCRIPTION_ACK':
      console.log('Suscripción activa para proveedores:', message.providers);
      break;

    case 'BAD_REQUEST':
      console.error('Error de suscripción:', message.message);
      break;

    case 'TABLE_UPDATE':
      const { external_id, gameType, eventType, realtime, lastResult } = message.data;
      handleTableUpdate(message.data);
      break;
  }
};

ws.onerror = (err) => console.error('WebSocket error:', err);
ws.onclose = (e)  => console.log('Desconectado:', e.code, e.reason);
```

### 4. Filtrar por proveedor en el cliente

```js
function handleTableUpdate(patch) {
  switch (patch.idProveedor) {
    case 1: updateEzugiTable(patch);     break;
    case 2: updateEvolutionTable(patch); break;
    case 3: updatePragmaticTable(patch); break;
    case 4: updatePlaytechTable(patch);  break;
  }
}
```

> **Nota:** El servidor ya filtra server-side — cada cliente solo recibe mensajes de los proveedores a los que se suscribió. El filtro en el cliente es opcional como capa extra de seguridad.

---

## Flujo de conexión

```
CLIENTE                              SERVIDOR
  │                                      │
  │──── WebSocket connect ────────────►  │
  │                                      │  SessionManager.addSession()
  │                                      │
  │──── { token, provider_type } ──────► │
  │                                      │  DefaultSubscriptionValidator.validate()
  │                                      │  SessionManager.activateSubscription()
  │ ◄── { event: SUBSCRIPTION_ACK } ───  │
  │                                      │
  │          [proveedor emite evento]     │
  │                                      │  LobbyStateManager.updateTableState()
  │ ◄── { event: TABLE_UPDATE, data } ─  │  (solo si client suscrito al idProveedor)
  │                                      │
  │──── [cierra conexión] ─────────────► │
  │                                      │  SessionManager.removeSession()
```

---

## Códigos de cierre WebSocket

| Código | Motivo |
|--------|--------|
| `1000` | Cierre normal |
| `1008` | Payload inválido en el mensaje de suscripción (BAD_REQUEST) |

---

## Variables de entorno requeridas

| Variable | Descripción | Proveedor |
|----------|-------------|-----------|
| `WS_PORT` | Puerto del servidor (default: 3000) | — |
| `EVOLUTION_LICENSEE_HOSTNAME` | Hostname del API de Evolution | Evolution |
| `EVOLUTION_CASINO_ID` | ID del casino en Evolution | Evolution |
| `EVOLUTION_CASINO_KEY` | Clave de autenticación Evolution | Evolution |
| `EVOLUTION_API_TOKEN` | Token API Evolution | Evolution |
| `EVOLUTION_CURRENCY` | Moneda (default: COP) | Evolution |
| `PRAGMATIC_DGA_URL` | URL WebSocket DGA de Pragmatic | Pragmatic |
| `PRAGMATIC_CASINO_ID` | ID del casino en Pragmatic | Pragmatic |
| `PRAGMATIC_CURRENCY` | Moneda (default: COP) | Pragmatic |
| `PRAGMATIC_TABLE_IDS` | IDs de mesas separados por coma | Pragmatic |
| `PLAYTECH_KAFKA_BROKERS` | Brokers Kafka separados por coma | Playtech |
| `PLAYTECH_KAFKA_CLIENT_ID` | Client ID Kafka | Playtech |
| `PLAYTECH_KAFKA_GROUP_ID` | Group ID Kafka | Playtech |
| `PLAYTECH_KAFKA_TOPIC` | Topic Kafka de Playtech | Playtech |
| `PLAYTECH_REST_URL` | URL base REST de Playtech | Playtech |
| `PLAYTECH_REST_TOKEN` | Bearer token REST | Playtech |

---

## Arquitectura de proveedores upstream

| Proveedor | ID | Protocolo | Reconexión |
|-----------|----|-----------|------------|
| Ezugi | 1 | WSS (hereda conector Evolution con `gameProvider=ezugi`) | Backoff exponencial + jitter |
| Evolution Gaming | 2 | WSS + HTTP snapshot inicial | Backoff exponencial, sin reintento en 401 |
| Pragmatic Play | 3 | WSS DGA con suscripción `subscribe` | Backoff exponencial + heartbeat 35s |
| Playtech | 4 | Kafka mTLS + REST snapshot | Backoff exponencial en consumer crash |

---

## Cómo visualizar la especificación AsyncAPI

### Respuesta corta

No. Solo con crear el `.yaml` en la raíz **no se genera ningún visualizador automáticamente**. AsyncAPI no es Swagger/OpenAPI — no tiene un servidor de UI integrado. Necesitás un paso extra para renderizarlo.

---

### Opción 1 — Extensión para VS Code (recomendada para desarrollo)

**AsyncAPI Preview**
- Autor: `asyncapi`
- ID: `asyncapi.asyncapi-preview`
- Instalación: buscar `AsyncAPI Preview` en el panel de extensiones de VS Code

Una vez instalada, abrís tu archivo `.yaml` y usás el comando:
```
AsyncAPI: Open Preview
```
o el atajo `Ctrl+Shift+P` → `AsyncAPI Preview`.

Muestra el diagrama de canales, mensajes y schemas renderizados en tiempo real sin salir del editor.

---

### Opción 2 — AsyncAPI Studio (online, sin instalación)

Ir a [studio.asyncapi.com](https://studio.asyncapi.com), pegar el contenido del `.yaml` y visualizarlo de forma interactiva. Útil para compartir con el equipo sin configurar nada.

---

### Opción 3 — Generar HTML estático con el CLI oficial

Instalar el CLI de AsyncAPI:

```bash
npm install -g @asyncapi/cli
```

Generar el HTML de documentación:

```bash
asyncapi generate fromTemplate asyncapi.yaml @asyncapi/html-template -o docs/
```

Esto genera una carpeta `docs/` con un `index.html` que podés abrir en el navegador o desplegar en GitHub Pages / Netlify.

Para previsualizarlo localmente:

```bash
asyncapi preview asyncapi.yaml
```

Abre un servidor local en `http://localhost:3000` con la UI interactiva.

---

### Opción 4 — Script npm para generar la documentación

Agregar al `package.json`:

```json
"scripts": {
  "docs": "asyncapi generate fromTemplate asyncapi.yaml @asyncapi/html-template -o docs/"
}
```

Luego correr:

```bash
npm run docs
```

---

### Pasos recomendados

1. Crear el archivo `asyncapi.yaml` en la raíz del proyecto con el contenido de la sección **Especificación AsyncAPI 2.6** de este documento.
2. Instalar la extensión **AsyncAPI Preview** en VS Code para previsualización inmediata.
3. Instalar el CLI (`npm install -g @asyncapi/cli`) para generar el HTML estático cuando necesites compartirlo.
4. Agregar `docs/` al `.gitignore` si no querés versionar el HTML generado, o commitearlo si querés servirlo como documentación estática.

---

### Comparativa de opciones

| Opción | Instalación | Uso | Ideal para |
|--------|-------------|-----|------------|
| VS Code Extension | Extensión en el editor | Previsualización en desarrollo | Uso diario mientras codificás |
| AsyncAPI Studio | Ninguna (online) | Pegar YAML en el browser | Compartir con el equipo rápido |
| CLI + HTML template | `npm install -g @asyncapi/cli` | `asyncapi generate ...` | Documentación estática desplegable |
