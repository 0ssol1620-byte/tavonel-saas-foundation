"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Logomark from "@/components/logomark";
import styles from "./trust.module.css";

type StatusPayload = {
  mode: string;
  auth: string;
  billing: string;
  r2: string;
  signedExport: string;
  coreV2: string;
};

type TrustState = "qualified" | "demonstrated" | "research" | "human-gate";

const CONTROL_ROWS: Array<{
  key: keyof Omit<StatusPayload, "mode">;
  label: string;
  readyValue: string;
  evidence: string;
}> = [
  { key: "auth", label: "Authentication", readyValue: "google_oauth_configured", evidence: "Google OAuth configuration is present." },
  { key: "billing", label: "Billing path", readyValue: "sandbox_checkout_ready", evidence: "Sandbox checkout dependencies are configured; this is not live settlement proof." },
  { key: "r2", label: "Object storage", readyValue: "signer_configured", evidence: "The expected R2 signer and bucket configuration are present." },
  { key: "signedExport", label: "Signed exports", readyValue: "signed_export_ready", evidence: "An export-signing configuration is present." },
  { key: "coreV2", label: "Compiler runtime", readyValue: "python_core_v2_configured", evidence: "The Python core v2 runtime configuration is present." },
];

function isStatusPayload(value: unknown): value is StatusPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return ["mode", "auth", "billing", "r2", "signedExport", "coreV2"].every(
    (key) => typeof record[key] === "string",
  );
}

function stateLabel(state: TrustState) {
  if (state === "human-gate") return "HUMAN GATE";
  if (state === "research") return "RESEARCH FRONTIER";
  return state.toUpperCase();
}

export default function TrustPage() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function readStatus() {
      try {
        const response = await fetch("/api/status", {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`status_${response.status}`);
        const payload: unknown = await response.json();
        if (!isStatusPayload(payload)) throw new Error("status_contract_invalid");
        setStatus(payload);
        setCheckedAt(new Date().toISOString());
      } catch (error) {
        if (controller.signal.aborted) return;
        setStatus(null);
        setFailure(error instanceof Error ? error.message : "status_unavailable");
        setCheckedAt(new Date().toISOString());
      }
    }

    void readStatus();
    return () => controller.abort();
  }, []);

  const endpointState: TrustState = status ? "demonstrated" : "human-gate";

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.wordmark} aria-label="TAVONEL home"><Logomark /><b>TAVONEL</b></Link>
        <nav aria-label="Trust navigation"><Link href="/security">Security</Link><Link href="/status">Status</Link></nav>
        <Link className={styles.signIn} href="/login">Sign in</Link>
      </header>

      <main id="main">
        <section className={styles.hero} aria-labelledby="trust-title">
          <p className={styles.eyebrow}>TRUST CENTER / PUBLIC RECORD</p>
          <div className={styles.heroGrid}>
            <div>
              <h1 id="trust-title">Trust is a state,<br />not a slogan.</h1>
              <p className={styles.lede}>A fail-closed view of what this deployment can substantiate now. Configuration is not certification, and a self-check is not an independent audit.</p>
            </div>
            <div className={styles.liveRecord} data-state={endpointState}>
              <span className={styles.state}>{stateLabel(endpointState)}</span>
              <strong>{status ? "Status contract received" : failure ? "Status unavailable" : "Checking status contract"}</strong>
              <p>{status ? `Self-reported mode: ${status.mode}.` : "No affirmative control state is shown until /api/status returns a valid response."}</p>
              <small>{checkedAt ? `Checked ${new Date(checkedAt).toLocaleString("en-GB")}` : "Live check in progress"}</small>
            </div>
          </div>
        </section>

        <section className={styles.controls} aria-labelledby="controls-title">
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>DEPLOYMENT CONTROLS</p>
            <h2 id="controls-title">Evidence before affirmation.</h2>
          </div>
          <div className={styles.controlList} aria-live="polite">
            {CONTROL_ROWS.map((control) => {
              const demonstrated = status?.[control.key] === control.readyValue;
              const state: TrustState = demonstrated ? "demonstrated" : "human-gate";
              return (
                <article key={control.key} className={styles.control} data-state={state}>
                  <span className={styles.state}>{stateLabel(state)}</span>
                  <h3>{control.label}</h3>
                  <p>{demonstrated ? control.evidence : status ? `Expected control state was not reported. Current value: ${status[control.key]}.` : "Held closed because current status could not be established."}</p>
                </article>
              );
            })}
          </div>
          <p className={styles.disclaimer}>These records report application configuration only. TAVONEL does not claim SOC 2, ISO 27001, penetration-test certification, or an independent security audit on the basis of this page.</p>
        </section>

        <section className={styles.vocabulary} aria-labelledby="vocabulary-title">
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>CLAIM VOCABULARY</p>
            <h2 id="vocabulary-title">Four words, four boundaries.</h2>
          </div>
          <dl>
            <div data-state="qualified"><dt>QUALIFIED</dt><dd>A control supported by scoped, repeatable evidence and approved for its stated use. This label is never inferred from configuration alone.</dd></div>
            <div data-state="demonstrated"><dt>DEMONSTRATED</dt><dd>Observed in a bounded test or self-check. It is evidence of that event, not a promise of continuous operation.</dd></div>
            <div data-state="research"><dt>RESEARCH FRONTIER</dt><dd>An active direction that is not a shipped production capability.</dd></div>
            <div data-state="human-gate"><dt>HUMAN GATE</dt><dd>No automated promotion. A person must review the evidence and explicitly approve the next state.</dd></div>
          </dl>
        </section>

        <section className={styles.records} aria-labelledby="records-title">
          <div>
            <p className={styles.eyebrow}>GOVERNANCE RECORDS</p>
            <h2 id="records-title">Follow the policy, not the badge.</h2>
          </div>
          <nav aria-label="Governance records">
            <Link href="/subprocessors"><span>01</span><b>Subprocessors</b><small>Providers, purposes and data categories</small></Link>
            <Link href="/privacy#storage-and-lifecycle"><span>02</span><b>Retention</b><small>Storage lifecycle and deletion boundaries</small></Link>
            <Link href="/status"><span>03</span><b>Incidents</b><small>Current state and incident contact</small></Link>
          </nav>
        </section>

        <section className={styles.vocabulary} aria-labelledby="maturity-title">
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>CONTROL MATURITY</p>
            <h2 id="maturity-title">Evidence grows in named stages.</h2>
          </div>
          <dl>
            <div data-state="demonstrated"><dt>CONFIGURED</dt><dd>A dependency or control is present in this deployment. Configuration alone does not establish continuous effectiveness.</dd></div>
            <div data-state="demonstrated"><dt>DEMONSTRATED</dt><dd>A bounded self-check or operational receipt observed the control performing its stated action.</dd></div>
            <div data-state="human-gate"><dt>QUALIFIED</dt><dd>Repeatable evidence, declared scope and a human approval record are all required. This page does not infer the state.</dd></div>
            <div data-state="human-gate"><dt>INDEPENDENTLY AUDITED</dt><dd>No external audit or certification is represented until the report, scope, period and issuing body are registered.</dd></div>
          </dl>
        </section>
      </main>

      <footer className={styles.footer}>
        <p>Security reports: <a href="mailto:security@tavonel.com">security@tavonel.com</a></p>
        <p>Self-reported deployment record. No certification implied.</p>
      </footer>
    </div>
  );
}
