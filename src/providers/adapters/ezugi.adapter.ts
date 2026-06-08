import { LobbyTablePatch } from "../../domain/LobbyTablePatch";
import { ProviderAdapter } from "./base.adapter";

export class EzugiAdapter extends ProviderAdapter {

  normalize(payload: any): LobbyTablePatch | null {

    if (payload.type === 'table_assigned' || payload.type === 'table_updated') {
      if (!payload.table?.id) return null;
      const table = payload.table;
      return {
        external_id:     `ezugi_${table.id}`,
        idProveedor:     1,
        nameProveedor:   'EZUGI_PROVIDER',
        providerTableId: table.id,
        gameType:        this.resolveGameType(table.gameType),
        eventType:       table.isOpen ? 'TABLE_OPENED' : 'TABLE_CLOSED',
        realtime: {
          isAvailable:    table.isOpen ?? undefined,
          minBet:         table.limits?.min,
          maxBet:         table.limits?.max,
          currency:       table.limits?.currency,
          availableSeats: table.seats?.filter((s: any) => !s.occupied).length,
          updatedAt:      this.now(),
        },
      };
    }

    if (payload.type === 'table_closed') {
      if (!payload.tableId) return null;
      return {
        external_id:     `ezugi_${payload.tableId}`,
        idProveedor:     1,
        nameProveedor:   'EZUGI_PROVIDER',
        providerTableId: payload.tableId,
        gameType:        'other',
        eventType:       'TABLE_CLOSED',
        realtime: {
          isAvailable: false,
          updatedAt:   this.now(),
          minBet: payload.minBet
        },
      };
    }

    if (payload.type === 'seats_updated') {
      if (!payload.tableId) return null;
      const freeSeats = Array.isArray(payload.seats)
        ? payload.seats.filter((s: any) => !s.occupied).length
        : undefined;
      return {
        external_id:     `ezugi_${payload.tableId}`,
        idProveedor:     1,
        nameProveedor:   'EZUGI_PROVIDER',
        providerTableId: payload.tableId,
        gameType:        'blackjack',
        eventType:       'SEATS_UPDATED',
        realtime: {
          availableSeats: freeSeats,
          updatedAt:      this.now(),
          minBet: payload.minBet
        },
      };
    }

    if (payload.type === 'players_updated') {
      if (!payload.tableId) return null;
      return {
        external_id:     `ezugi_${payload.tableId}`,
        idProveedor:     1,
        nameProveedor:   'EZUGI_PROVIDER',
        providerTableId: payload.tableId,
        gameType:        'other',
        eventType:       'PLAYERS_UPDATED',
        realtime: {
          playersOnline: payload.playersCount,
          updatedAt:     this.now(),
          minBet: payload.minBet
        },
      };
    }

    return null;
  }

  private resolveGameType(gameType?: string): LobbyTablePatch['gameType'] {
    const map: Record<string, LobbyTablePatch['gameType']> = {
      roulette:         'roulette',
      americanroulette: 'roulette',
      blackjack:        'blackjack',
      baccarat:         'baccarat',
      'dragon-tiger':   'dragon-tiger',
      sicbo:            'sicbo',
      poker:            'poker',
    };
    return map[String(gameType).toLowerCase()] ?? 'other';
  }
}
