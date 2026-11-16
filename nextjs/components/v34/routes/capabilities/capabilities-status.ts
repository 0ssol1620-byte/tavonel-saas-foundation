import { GET } from "@/app/api/status/route";
import type { StatusResponse } from "@/lib/capabilities";

/** How long the page waits for the status read before it says Unknown. */
export const STATUS_TIMEOUT_MS = 2000;

export type StatusRead = { status: StatusResponse | null; failed: boolean };

const readOwnStatus = async (): Promise<unknown> => GET().json();

/**
 * One bounded, server-side read of the deployment status. Anything but a well-formed object in time
 * (a throw, a timeout, a malformed body) is `failed`, which readCapabilities turns into Unknown rows.
 */
export async function readStatusBounded(read: () => Promise<unknown> = readOwnStatus, timeoutMs = STATUS_TIMEOUT_MS): Promise<StatusRead> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = await Promise.race([
      read(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("status read timed out")), timeoutMs); }),
    ]);
    if (typeof body !== "object" || body === null || Array.isArray(body)) return { status: null, failed: true };
    return { status: body as StatusResponse, failed: false };
  } catch {
    return { status: null, failed: true };
  } finally {
    clearTimeout(timer);
  }
}
