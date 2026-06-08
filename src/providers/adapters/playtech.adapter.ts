
import { LobbyTablePatch } from "../../domain/LobbyTablePatch";
import { ProviderAdapter } from "./base.adapter";

/**
 * Normaliza los eventos de Playtech (vía Kafka) al modelo interno LobbyTablePatch.
 *
 * Formato de entrada esperado (PlaytechKafkaEvent):
 * {
 *   table_id: string,
 *   status: "OPEN" | "CLOSED",
 *   free_seats: number,
 *   min_bet?: number,
 *   currency?: string,
 *   timestamp: string
 * }
 */
export class PlaytechAdapter extends ProviderAdapter {
  normalize(payload: any): LobbyTablePatch | null {
    if (!payload || !payload.table_id) return null;

    const isOpen = payload.status === "OPEN";

    return {
      external_id: `playtech_${payload.table_id}`,
      idProveedor: 4,
      nameProveedor: 'PLAYTECH_PROVIDER',
      providerTableId: payload.table_id,
      gameType: this.resolveGameType(payload.game_type),
      eventType: isOpen ? "TABLE_OPENED" : "TABLE_CLOSED",
      realtime: {
        isAvailable: isOpen,
        availableSeats: payload.free_seats ?? undefined,
        minBet: payload.min_bet ?? undefined,
        currency: payload.currency ?? undefined,
        updatedAt: payload.timestamp ?? this.now(),
      },
    };
  }

  private resolveGameType(gameType: string): LobbyTablePatch["gameType"] {
    const map: Record<string, LobbyTablePatch["gameType"]> = {
      roulette: "roulette",
      blackjack: "blackjack",
      baccarat: "baccarat",
      "dragon-tiger": "dragon-tiger",
      sicbo: "sicbo",
      poker: "poker",
    };
    return map[String(gameType).toLowerCase()] ?? "other";
  }
}
