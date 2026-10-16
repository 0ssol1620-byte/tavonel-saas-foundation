/** Stop only the child handle created by this harness, including a bounded forced fallback. */
export async function stopOwnedChild(child, { graceMs = 10_000, forceMs = 5_000 } = {}) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise(resolve => child.once("close", resolve));
  async function wait(ms) {
    let timer;
    try { return await Promise.race([closed.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), ms); })]); }
    finally { clearTimeout(timer); }
  }
  child.kill("SIGTERM");
  if (await wait(graceMs)) return;
  child.kill("SIGKILL");
  if (!await wait(forceMs)) throw new Error("Owned child failed to stop after forced termination");
}
