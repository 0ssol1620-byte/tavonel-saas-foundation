"use client";

import { useEffect, useState } from "react";

export default function GoogleDriveAccessPage() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("oauth") === "linked") {
      setMessage("Google Drive identity linked. This link expires in 24 hours unless you renew it.");
    }
  }, []);

  async function linkGoogleAccount() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/oauth-connectors/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "google_drive", displayName: "Google Drive viewer identity", purpose: "viewer_acl_link" }),
      });
      const body = await response.json() as { authorizationUrl?: unknown; code?: unknown };
      if (!response.ok || typeof body.authorizationUrl !== "string") {
        setMessage(typeof body.code === "string" ? body.code : "GOOGLE_VIEWER_LINK_FAILED");
        return;
      }
      window.location.assign(body.authorizationUrl);
    } catch {
      setMessage("GOOGLE_VIEWER_LINK_FAILED");
    } finally {
      setBusy(false);
    }
  }

  async function unlinkGoogleAccount() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/oauth-connectors/viewer-links/revoke", { method: "POST" });
      const body = await response.json() as { code?: unknown };
      setMessage(response.ok ? "Google Drive identity link removed." : typeof body.code === "string" ? body.code : "GOOGLE_VIEWER_UNLINK_FAILED");
    } catch {
      setMessage("GOOGLE_VIEWER_UNLINK_FAILED");
    } finally {
      setBusy(false);
    }
  }

  return <main>
    <h1>Link your Google Drive identity</h1>
    <p>This verifies which Google Drive user you are. TAVONEL reads the Drive user permission ID using the read-only Drive metadata scope.</p>
    <p>This identity link does not create a connector, import files, or store a Google refresh token. Access is denied when this link is missing, revoked, or older than 24 hours.</p>
    <button type="button" disabled={busy} onClick={linkGoogleAccount}>Continue to Google and link identity</button>
    <button type="button" disabled={busy} onClick={unlinkGoogleAccount}>Remove my Google Drive identity link</button>
    <p role="status" aria-live="polite">{message}</p>
  </main>;
}
