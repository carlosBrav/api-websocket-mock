import { LobbyTablePatch } from "../../domain/LobbyTablePatch";


export abstract class ProviderAdapter {

  abstract normalize(
    payload: unknown
  ): LobbyTablePatch | null;

  protected now(): string {

    return new Date()
      .toISOString();
  }
}