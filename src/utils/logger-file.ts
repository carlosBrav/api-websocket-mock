import fs from 'fs';

import path from 'path';

interface WebSocketLoggerOptions {

  providerName: string;

  maxMessages?: number;
}

export class WebSocketLogger {

  private readonly providerName: string;

  private readonly maxMessages: number;

  private counter: number;

  private readonly logFilePath: string;

  constructor({
    providerName,
    maxMessages = 10
  }: WebSocketLoggerOptions) {

    this.providerName = providerName;

    this.maxMessages = maxMessages;

    this.counter = 0;

    this.logFilePath = path.join(
      process.cwd(),
      `${providerName}-responses.txt`
    );

    /**
     * Reinicia archivo
     */
    fs.writeFileSync(
      this.logFilePath,
      ''
    );
  }

  save(payload: unknown): void {

    if (this.counter >= this.maxMessages) {
      return;
    }

    this.counter++;

    const content = `

========== ${this.providerName.toUpperCase()} RESPONSE ${this.counter} ==========

${JSON.stringify(payload, null, 2)}

`;

    fs.appendFileSync(
      this.logFilePath,
      content
    );

    console.log(
      `📝 ${this.providerName} response ${this.counter} saved`
    );
  }
}