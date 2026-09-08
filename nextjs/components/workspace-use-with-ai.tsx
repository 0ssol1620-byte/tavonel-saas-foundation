"use client";

import Link from "next/link";
import { AI_PACKAGE_CONTENTS, AI_PACKAGE_SUMMARY, AI_USE_JOURNEY } from "@/lib/ai-package-guidance";

/*
  What "Use with AI" actually means, in one place.

  It was two disagreeing explanations: a `<details>` on the Sources surface that described the
  ZIP, and a bare "Use with AI" link on Home that described nothing. The file list here is the
  one the export writes (see `AI_PACKAGE_CONTENTS`), so the screen cannot promise an artifact
  the archive does not contain.
*/

export default function WorkspaceUseWithAi({
  open = false,
  onDownload,
  onOpen,
  downloading = false,
}: {
  open?: boolean;
  onDownload?: () => void;
  /** Fired when the reader opens the guide. The workspace has no connect dialog; this
   *  disclosure is the only MCP/API intent signal it actually has. */
  onOpen?: () => void;
  downloading?: boolean;
}) {
  return (
    <details
      className="workspace-ai-use-guide"
      data-testid="workspace-ai-use-guide"
      open={open}
      onToggle={(event) => { if (event.currentTarget.open) onOpen?.(); }}
    >
      <summary>Use with AI</summary>
      <div>
        <p>{AI_PACKAGE_SUMMARY}</p>

        <p className="eyebrow">THE JOURNEY</p>
        <ol className="workspace-ai-journey">
          {AI_USE_JOURNEY.map((step) => <li key={step}>{step}</li>)}
        </ol>

        <p><strong>Live AI:</strong> the TAVONEL MCP/API is the preferred integration, because it reads the current active revision under the current access rules and resolves evidence for each answer.</p>
        <p><strong>Local agent:</strong> download the signed package, extract it, give the agent access to that folder, then tell it to read <code>AGENTS.md</code> first.</p>
        <p><strong>Web chat:</strong> upload the archive where archive input is supported, or upload the structured files named in <code>manifest/ai-entrypoint.json</code>.</p>
        <small>A folder path by itself grants no access. The AI application needs permission and a tool that can read those files.</small>

        <p className="eyebrow">WHAT THE SIGNED PACKAGE CONTAINS</p>
        <ul className="workspace-ai-package-files">
          {AI_PACKAGE_CONTENTS.map((file) => (
            <li key={file.path}><code>{file.path}</code><small>{file.purpose}</small></li>
          ))}
        </ul>

        <div className="workspace-ai-use-actions">
          {onDownload ? (
            <button type="button" disabled={downloading} onClick={onDownload}>
              {downloading ? "Preparing…" : "Download signed package"}
            </button>
          ) : null}
          <Link href="/docs/use-with-ai">Read the AI integration guide</Link>
          <Link href="/docs/ontology-output">Use ontology output</Link>
        </div>
      </div>
    </details>
  );
}
