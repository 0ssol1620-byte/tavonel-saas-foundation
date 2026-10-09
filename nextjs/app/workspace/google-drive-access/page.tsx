"use client";

import { useEffect, useState } from "react";
import { postGoogleViewerLinkRequest } from "@/lib/google-drive-viewer-link-request";

export default function GoogleDriveAccessPage() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("oauth") === "linked") {
      setMessage("Returned from Google. Source access is checked when you request data.");
    }
  }, []);

  async function linkGoogleAccount() {
    setBusy(true);
    setMessage("");
    try {
      const result = await postGoogleViewerLinkRequest("authorize");
      if (!result.ok) {
        setMessage(result.code);
        return;
      }
      if (typeof result.authorizationUrl !== "string") {
        setMessage("GOOGLE_VIEWER_LINK_FAILED");
        return;
      }
      window.location.assign(result.authorizationUrl);
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
      const result = await postGoogleViewerLinkRequest("revoke");
      setMessage(result.ok ? "Google Drive identity link removed." : result.code);
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
