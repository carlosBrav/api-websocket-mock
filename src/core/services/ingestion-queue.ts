export class IngestionQueue {
  private queue: Array<() => void> = [];
  private processing = false;
  private droppedCount = 0;
  private readonly MAX_SIZE: number;

  constructor(maxSize = parseInt(process.env.INGESTION_QUEUE_MAX_SIZE || '2000', 10)) {
    this.MAX_SIZE = maxSize;
  }

  public enqueue(task: () => void): void {
    if (this.queue.length >= this.MAX_SIZE) {
      this.queue.shift();
      this.droppedCount++;
      if (this.droppedCount % 100 === 0) {
        console.warn(`[IngestionQueue] ⚠ ${this.droppedCount} mensajes descartados.`);
      }
    }
    this.queue.push(task);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.processing) return;
    this.processing = true;
    setImmediate(() => this.flush());
  }

  private flush(): void {
    const task = this.queue.shift();
    if (task) {
      try { task(); } catch (err: any) {
        console.error('[IngestionQueue] Error en tarea:', err.message);
      }
    }
    if (this.queue.length > 0) {
      setImmediate(() => this.flush());
    } else {
      this.processing = false;
    }
  }

  public get size(): number { return this.queue.length; }
  public get dropped(): number { return this.droppedCount; }
}