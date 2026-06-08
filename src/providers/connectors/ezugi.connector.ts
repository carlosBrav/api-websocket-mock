import { EvolutionConnector } from './evolution.connector';

export class EzugiConnector extends EvolutionConnector {
  protected override getGameProvider(): string {
    return 'ezugi';
  }
}