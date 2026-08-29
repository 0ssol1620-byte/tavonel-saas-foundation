"use client";

/**
 * The upload, with the bytes visible.
 *
 * `fetch` cannot report upload progress. A request body stream would be the modern answer, but it
 * is gated behind HTTP/2 and `duplex: "half"` and is not available everywhere, so a PUT made with
 * `fetch` is a black box from the moment it starts until the moment it ends. For a 40 MB scan on a
 * hotel connection that black box is the entire experience.
 *
 * `XMLHttpRequest` still reports it, so this is the one place the older API is the correct one.
 * What it gives back is not an estimate: `loaded` and `total` are bytes acknowledged by the
 * transport, and the destination is the quarantine bucket the browser is talking to directly. The
 * application server is not in this path and does not become part of it here.
 */

export type TransferProgress = {
  /** Bytes the transport has acknowledged. */
  loaded: number;
  /** Bytes in the file. */
  total: number;
};

export type TransferResult =
  | { ok: true; status: number }
  | { ok: false; status: number; reason: "http" | "network" | "aborted" };

export type TransferHandle = {
  /** Resolves once the transfer settles, in every outcome. It never rejects. */
  done: Promise<TransferResult>;
  abort: () => void;
};

/**
 * PUTs a file to a presigned URL and reports byte progress while it goes.
 *
 * The presigned URL carries its own authorization, so no credential is attached here. The
 * content type must be the one the capability was signed for; sending a different one produces a
 * signature mismatch at the bucket rather than a silent re-type.
 */
export function putWithProgress(
  url: string,
  file: Blob,
  contentType: string,
  onProgress?: (progress: TransferProgress) => void,
): TransferHandle {
  const request = new XMLHttpRequest();
  const done = new Promise<TransferResult>((resolve) => {
    let settled = false;
    const settle = (result: TransferResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    request.upload.addEventListener("progress", (event) => {
      if (!onProgress) return;
      // `lengthComputable` is false on some proxies. Falling back to the file's own size is
      // honest here -- it is the number of bytes we handed to the transport, not a guess.
      const total = event.lengthComputable && event.total > 0 ? event.total : file.size;
      onProgress({ loaded: Math.min(event.loaded, total), total });
    });
    // A completed upload does not always emit a final progress event at 100%.
    request.upload.addEventListener("load", () => onProgress?.({ loaded: file.size, total: file.size }));

    request.addEventListener("load", () =>
      settle(request.status >= 200 && request.status < 300
        ? { ok: true, status: request.status }
        : { ok: false, status: request.status, reason: "http" }));
    request.addEventListener("error", () => settle({ ok: false, status: 0, reason: "network" }));
    request.addEventListener("timeout", () => settle({ ok: false, status: 0, reason: "network" }));
    request.addEventListener("abort", () => settle({ ok: false, status: 0, reason: "aborted" }));

    request.open("PUT", url, true);
    request.setRequestHeader("content-type", contentType);
    request.send(file);
  });

  return { done, abort: () => request.abort() };
}
