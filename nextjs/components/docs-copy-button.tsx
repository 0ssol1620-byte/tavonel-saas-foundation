"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Copy, with the one piece of feedback that matters.
 *
 * The clipboard write can fail -- an insecure origin, a browser that refuses without a user
 * gesture it recognises, a permission policy -- and a button that always flashes "Copied"
 * whether or not anything reached the clipboard is worse than one that never claims to.
 */
export function DocsCopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  return (
    <button
      type="button"
      className="docs-copy"
      data-state={state}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState("copied");
        } catch {
          setState("failed");
        }
        setTimeout(() => setState("idle"), 2_000);
      }}
    >
      {state === "copied" ? <Check size={12} /> : <Copy size={12} />}
      {state === "copied" ? "Copied" : state === "failed" ? "Select and copy" : label}
    </button>
  );
}
