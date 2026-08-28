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
}

interface Message<Body = unknown> {
  readonly body: Body;
  ack(): void;
  retry(): void;
}

interface MessageBatch<Body = unknown> {
  readonly messages: readonly Message<Body>[];
}