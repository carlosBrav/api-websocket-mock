
import { LobbyTablePatch } from "../../domain/LobbyTablePatch";
import { ProviderAdapter } from "./base.adapter";

export class EvolutionAdapter extends ProviderAdapter {
  normalize(payload: any): LobbyTablePatch | null {
    console.log("PAYLOAD ", payload)
    if (payload.type === "players_updated" || payload.type === 'PlayersUpdated') {
      return {
        external_id: `evolution_${payload.tableId}`,
        idProveedor: 2,
        nameProveedor: 'EVOUTION_PROVIDER',
        providerTableId: payload.tableId,
        gameType: payload.gameType,
        eventType: "PLAYERS_UPDATED",
        realtime: {
          playersOnline: payload.playersCount,
          updatedAt: this.now(),
          minBet: payload.minBet
        },
      };
    }
    if (payload.type === "betting_opened" || payload.type === 'BettingOpened') {
      return {
        external_id: `evolution_${payload.tableId}`,
        idProveedor: 2,
        nameProveedor: 'EVOUTION_PROVIDER',
        providerTableId: payload.tableId,
        gameType: payload.gameType,
        eventType: "BETTING_OPENED",
        realtime: {
          bettingOpen: true,
          updatedAt: this.now(),
          minBet: payload.minBet
        },
      };
    }
    if (payload.type === "result_updated" || payload.type === 'ResultUpdated') {
      return {
        external_id: `evolution_${payload.tableId}`,
        idProveedor: 2,
        nameProveedor: 'EVOUTION_PROVIDER',
        providerTableId: payload.tableId,
        gameType: payload.gameType,
        eventType: "RESULT_UPDATED",
        realtime: {
          updatedAt: this.now(),
          minBet: payload.minBet
        },
        lastResult: {
          winningNumber: payload.result?.winningNumber,
          winner: payload.result?.winner,
          roundId: payload.result?.roundId,
        },
      };
    }
    if (payload.type === 'table_assigned' || 
        payload.type === 'table_updated' || 
        payload.type === 'TableAssigned' ||
        payload.type === 'TableUpdated') {
      if (!payload.table?.id) return null;
      const table = payload.table;
      return {
        external_id: `evolution_${table.id}`,
        idProveedor: 2,
        nameProveedor: 'EVOLUTION_PROVIDER',
        providerTableId: table.id,
        gameType: this.resolveGameType(table.gameType),
        eventType: table.isOpen ? 'TABLE_OPENED' : 'TABLE_CLOSED',
        realtime: {
          isAvailable: table.isOpen ?? undefined,
          minBet: table.limits?.min,
          maxBet: table.limits?.max,
          currency: table.limits?.currency,
          availableSeats: table.seats?.filter((s: any) => !s.occupied).length,
          updatedAt: this.now(),
        },
      };
    }

    // table_closed — mesa cerrada por el proveedor
    if (payload.type === 'table_closed' || payload.type === 'TableClosed') {
      if (!payload.tableId) return null;
      return {
        external_id: `evolution_${payload.tableId}`,
        idProveedor: 2,
        nameProveedor: 'EVOLUTION_PROVIDER',
        providerTableId: payload.tableId,
        gameType: 'other',
        eventType: 'TABLE_CLOSED',
        realtime: {
          isAvailable: false,
          updatedAt: this.now(),
          minBet: payload.minBet
        },
      };
    }

    // seats_updated — asientos libres en Blackjack
    if (payload.type === 'seats_updated' || payload.type === 'SeatsUpdated') {
      if (!payload.tableId) return null;
      const freeSeats = Array.isArray(payload.seats)
        ? payload.seats.filter((s: any) => !s.occupied).length
        : undefined;
      return {
        external_id: `evolution_${payload.tableId}`,
        idProveedor: 2,
        nameProveedor: 'EVOLUTION_PROVIDER',
        providerTableId: payload.tableId,
        gameType: 'blackjack',
        eventType: 'SEATS_UPDATED',
        realtime: {
          availableSeats: freeSeats,
          updatedAt: this.now(),
          minBet: payload.minBet
        },
      };
    }

    if (payload.type === 'table_unassigned' || payload.type === 'TableUnassigned') {
      if (!payload.tableId) return null;
      return {
        external_id: `evolution_${payload.tableId}`,
        idProveedor: 2,
        nameProveedor: 'EVOLUTION_PROVIDER',
        providerTableId: payload.tableId,
        gameType: 'other',
        eventType: 'TABLE_CLOSED',
        realtime: {
          isAvailable: false,
          updatedAt: this.now(),
          minBet: payload.minBet
        },
      };
    }
    return null;
  }

  private resolveGameType(gameType?: string): LobbyTablePatch['gameType'] {
    const map: Record<string, LobbyTablePatch['gameType']> = {
      roulette: 'roulette',
      americanroulette: 'roulette',
      blackjack: 'blackjack',
      baccarat: 'baccarat',
      'dragon-tiger': 'dragon-tiger',
      sicbo: 'sicbo',
      poker: 'poker',
      moneywheel: 'other',
      craps: 'other',
      dice: 'other',
    };
    return map[String(gameType).toLowerCase()] ?? 'other';
  }
}
