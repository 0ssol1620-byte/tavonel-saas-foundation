/** Enforce the intake byte ceiling while consuming the source stream. */
export async function readBoundedSourceBody(response: Response, maximumBytes: number): Promise<
  { ok: true; bytes: Uint8Array<ArrayBuffer> } |
  { ok: false; code: "SOURCE_SIZE_UNQUALIFIED" | "SOURCE_DOWNLOAD_FAILED" }
> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) throw new Error("SOURCE_BODY_LIMIT_INVALID");
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, code: "SOURCE_SIZE_UNQUALIFIED" };
  }
  if (!response.body) return { ok: false, code: "SOURCE_SIZE_UNQUALIFIED" };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value.byteLength > maximumBytes - size) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, code: "SOURCE_SIZE_UNQUALIFIED" };
      }
      size += chunk.value.byteLength;
      chunks.push(chunk.value);
    }
    if (size === 0) return { ok: false, code: "SOURCE_SIZE_UNQUALIFIED" };
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { ok: true, bytes };
  } catch {
    await reader.cancel().catch(() => undefined);
    return { ok: false, code: "SOURCE_DOWNLOAD_FAILED" };
  } finally { reader.releaseLock(); }
}
