/** Shared authentication gate for infrastructure workers; keep credentials identical to the existing sync worker. */
export function isInternalWorkerAuthorized(
  request: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const presented = request.headers.get("authorization")?.trim() ?? "";
  if (!presented.startsWith("Bearer ")) return false;
  const token = presented.slice("Bearer ".length);
  const configured = [env.FOUNDATION_WORKER_SECRET, env.CRON_SECRET]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length >= 32);
  return configured.some((candidate) => {
    if (token.length !== candidate.length) return false;
    let difference = 0;
    for (let index = 0; index < token.length; index += 1) {
      difference |= token.charCodeAt(index) ^ candidate.charCodeAt(index);
    }
    return difference === 0;
  });
}
