interface R2PutOptions {
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
  onlyIf?: { etagDoesNotMatch?: string };
}

interface R2ObjectBody {
  readonly size: number;
  readonly httpMetadata?: { contentType?: string; contentDisposition?: string };
  readonly customMetadata?: Record<string, string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: ArrayBuffer | ArrayBufferView | string, options?: R2PutOptions): Promise<unknown>;
  list(options?: { prefix?: string }): Promise<{ objects: Array<{ key: string }> }>;
}

interface Message<Body = unknown> {
  readonly body: Body;
  /** Cloudflare Queues counts delivery attempts from 1. */
  readonly attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

interface MessageBatch<Body = unknown> {
  readonly messages: readonly Message<Body>[];
}