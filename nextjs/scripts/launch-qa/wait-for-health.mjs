const url = process.env.QA_HEALTH_URL ?? "http://127.0.0.1:3117/api/healthz";
const deadline = Date.now() + 60_000;
let lastError = "not attempted";
while (Date.now() < deadline) {
  try {
    const response = await fetch(url);
    if (response.ok) {
      process.stdout.write(`Launch server ready at ${url}.\n`);
      process.exit(0);
    }
    lastError = `HTTP ${response.status}`;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }
  await new Promise(resolve => setTimeout(resolve, 1_000));
}
process.stderr.write(`LAUNCH_SERVER_BLOCKER: ${url} did not become ready (${lastError}).\n`);
process.exit(2);
