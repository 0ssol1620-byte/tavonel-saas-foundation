"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { FOUNDER_TEST_RESET_EMAIL } from "@/lib/founder-test-reset-contract";

const CONFIRMATION = "DELETE TEST DATA";

type PreparedReset = {
  resetId: string;
  manifestDigest: string;
  manifest: {
    r2Keys: string[];
    dbCounts: Record<string, number>;
  };
};

type State =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "prepared"; value: PreparedReset }
  | { kind: "failed"; code: string };

async function bearerToken() {
  const client = getSupabaseBrowserClient();
  const { data } = client ? await client.auth.getSession() : { data: { session: null } };
  return data.session?.access_token ?? null;
}

async function resetRequest(body: Record<string, string>) {
  const token = await bearerToken();
  if (!token) throw new Error("AUTH_REQUIRED");
  const response = await fetch("/api/account/test-reset", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof payload?.code === "string" ? payload.code : "FOUNDER_TEST_RESET_FAILED");
  return payload;
}

export default function FounderTestResetPanel() {
  const [eligible, setEligible] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    let current = true;
    void (async () => {
      const client = getSupabaseBrowserClient();
      const { data } = client ? await client.auth.getSession() : { data: { session: null } };
      if (current) setEligible(data.session?.user.email?.trim().toLowerCase() === FOUNDER_TEST_RESET_EMAIL);
    })();
    return () => { current = false; };
  }, []);

  const totals = useMemo(() => {
    if (state.kind !== "prepared") return null;
    return {
      databaseRows: Object.values(state.value.manifest.dbCounts).reduce((sum, count) => sum + count, 0),
      objects: state.value.manifest.r2Keys.length,
    };
  }, [state]);

  if (!eligible) return null;

  async function prepare() {
    setConfirmation("");
    setState({ kind: "loading", message: "Reading the exact test-data inventory…" });
    try {
      const payload = await resetRequest({ mode: "dry-run" });
      if (typeof payload?.resetId !== "string" || typeof payload.manifestDigest !== "string"
        || !payload.manifest || typeof payload.manifest !== "object") throw new Error("FOUNDER_TEST_RESET_RESPONSE_INVALID");
      setState({ kind: "prepared", value: payload as unknown as PreparedReset });
    } catch (error) {
      setState({ kind: "failed", code: error instanceof Error ? error.message : "FOUNDER_TEST_RESET_FAILED" });
    }
  }

  async function execute() {
    if (state.kind !== "prepared" || confirmation !== CONFIRMATION) return;
    setState({ kind: "loading", message: "Removing this workspace's test content…" });
    try {
      await resetRequest({ mode: "execute", resetId: state.value.resetId, manifestDigest: state.value.manifestDigest });
      window.location.assign("/workspace");
    } catch (error) {
      setState({ kind: "failed", code: error instanceof Error ? error.message : "FOUNDER_TEST_RESET_FAILED" });
    }
  }

  return (
    <section className="card billing-card" aria-labelledby="founder-test-reset-title">
      <div>
        <p className="eyebrow">Founder test account</p>
        <h2 id="founder-test-reset-title">Start this workspace from empty</h2>
        <p>Remove compiled test content, source records, connector state, and stored source objects. Your sign-in, owner role, founder access, and billing exemption remain.</p>
      </div>
      {state.kind === "idle" || state.kind === "failed" ? (
        <div className="billing-actions">
          <button type="button" onClick={() => void prepare()}>Review reset inventory</button>
        </div>
      ) : null}
      {state.kind === "loading" ? <p role="status">{state.message}</p> : null}
      {state.kind === "failed" ? <p className="billing-hold" role="alert">Reset stopped: {state.code}</p> : null}
      {state.kind === "prepared" && totals ? (
        <div>
          <p role="status">Ready to remove {totals.databaseRows.toLocaleString()} database rows and {totals.objects.toLocaleString()} stored objects from this test workspace.</p>
          <label htmlFor="founder-reset-confirmation">Type <strong>{CONFIRMATION}</strong> to confirm.</label>
          <input id="founder-reset-confirmation" value={confirmation}
            onChange={(event) => setConfirmation(event.currentTarget.value)} autoComplete="off" />
          <div className="billing-actions">
            <button type="button" onClick={() => void prepare()}>Refresh inventory</button>
            <button type="button" disabled={confirmation !== CONFIRMATION} onClick={() => void execute()}>
              Delete test data
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
