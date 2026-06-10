export interface LobbyTablePatch {
  external_id: string;
  idProveedor: number;
  nameProveedor: string;
  providerTableId: string;
  gameType:
    | 'roulette'
    | 'blackjack'
    | 'baccarat'
    | 'dragon-tiger'
    | 'sicbo'
    | 'poker'
    | 'other';
  eventType?:
    | 'TABLE_OPENED'
    | 'TABLE_CLOSED'
    | 'TABLE_UPDATED'
    | 'BETTING_OPENED'
    | 'BETTING_CLOSED'
    | 'PLAYERS_UPDATED'
    | 'SEATS_UPDATED'
    | 'RESULT_UPDATED'
    | 'CARDS_UPDATED';
  gameData?: {
    seats?: Array<{
      seatIndex: number;
      occupied: boolean;
      status?: 'AVAILABLE' | 'OCCUPIED' | 'LOCKED';
      seatCards?: string[];
      seatScore?: number;
    }>;
    
    currentRoundCards?: {
      dealerHand?: string[];
      playerHand?: string[];
      bankerHand?: string[];
    };

    statistics?: {
      shoeRoadmap?: string[];
      baccaratStats?: {
        playerWinsCount: number;
        bankerWinsCount: number;
        tieWinsCount: number;
        playerPairsCount?: number;
        bankerPairsCount?: number;
      };
      hotNumbers?: number[];
      coldNumbers?: number[];
    };
  };
  realtime: {
    isAvailable?: boolean;
    bettingOpen?: boolean;
    minBet: number;
    maxBet?: number;
    currency?: string;
    playersOnline?: number;
    availableSeats?: number;
    dealerName?: string;
    updatedAt: string;
  };
  lastResult?: {
    winningNumber?: number;
    winner?: string;
    playerHandValue?: number;
    bankerHandValue?: number;
    roundId?: number;
  };
}