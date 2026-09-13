"use client";

import Link from "next/link";
import { useId, useState, type KeyboardEvent } from "react";
import { AI_PACKAGE_CONTENTS, AI_PACKAGE_SUMMARY, AI_USE_JOURNEY } from "@/lib/ai-package-guidance";

const DESTINATIONS = [
  { id: "assistant", label: "AI assistant" },
  { id: "application", label: "My application" },
  { id: "files", label: "Local files" },
] as const;
type Destination = typeof DESTINATIONS[number]["id"];

/** Choosing a destination is setup intent, never a verified external connection. */
export default function WorkspaceUseWithAi({ open = false, onDownload, onOpen, downloading = false }: {
  open?: boolean;
  onDownload?: () => void;
  onOpen?: () => void;
  downloading?: boolean;
}) {
  const [destination, setDestination] = useState<Destination>("assistant");
  const uid = useId();
  const changeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = DESTINATIONS.findIndex(item => item.id === destination);
    const next = event.key === "ArrowRight" ? (index + 1) % 3 : event.key === "ArrowLeft" ? (index + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : null;
    if (next === null) return;
    event.preventDefault();
    const id = DESTINATIONS[next]!.id;
    setDestination(id);
    document.getElementById(`${uid}-${id}`)?.focus();
  };
  return (
    <details className="workspace-ai-use-guide" data-testid="workspace-ai-use-guide" open={open}
      onToggle={(event) => { if (event.currentTarget.open) onOpen?.(); }}>
      <summary>Use with AI</summary>
      <div>
        <p>Where would you like to use your knowledge?</p>
        <div className="one-path-ai-tabs" role="tablist" aria-label="AI destination" onKeyDown={changeWithKeyboard}>
          {DESTINATIONS.map(item => <button key={item.id} type="button" role="tab" id={`${uid}-${item.id}`} aria-selected={destination === item.id} aria-controls={`${uid}-panel`} tabIndex={destination === item.id ? 0 : -1} onClick={() => setDestination(item.id)}>{item.label}</button>)}
        </div>
        <div className="one-path-ai-destination" role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-${destination}`} tabIndex={0}>
          {destination === "assistant" ? <>
            <h3>Connect a supported assistant</h3>
            <p>Follow the MCP setup guide, then make a test request from your assistant. Live access requires an activated version and valid account permissions.</p>
            <Link href="/docs/mcp">Open assistant setup</Link>
          </> : destination === "application" ? <>
            <h3>Use the API from your application</h3>
            <p>Set up a scoped connection and test a request against your active knowledge. Keep credentials on your server, not in public client code.</p>
            <Link href="/docs/quickstart">Open the API quickstart</Link>
          </> : <>
            <h3>Take the knowledge with you</h3>
            <p>Download the signed package, extract it, give your agent access to the folder, and ask it to read <code>AGENTS.md</code> first.</p>
            <small>A folder path alone grants no access. Your AI needs permission and a file-reading tool. A downloaded package is a snapshot, not a live connection.</small>
            {onDownload ? <button type="button" disabled={downloading} onClick={onDownload}>{downloading ? "Preparing…" : "Download signed package"}</button> : <Link href="/docs/cli">See package setup</Link>}
          </>}
          <small className="one-path-ai-not-connected">Setup guidance only. An external AI connection has not been verified by this panel.</small>
        </div>
        <details className="one-path-ai-details"><summary>Package contents and advanced setup</summary>
          <p>{AI_PACKAGE_SUMMARY}</p>
          <ol className="workspace-ai-journey">{AI_USE_JOURNEY.map(step => <li key={step}>{step}</li>)}</ol>
          <ul className="workspace-ai-package-files">{AI_PACKAGE_CONTENTS.map(file => <li key={file.path}><code>{file.path}</code><small>{file.purpose}</small></li>)}</ul>
          <div className="workspace-ai-use-actions"><Link href="/docs/use-with-ai">AI integration guide</Link><Link href="/docs/ontology-output">Use ontology output</Link></div>
        </details>
      </div>
    </details>
  );
}
