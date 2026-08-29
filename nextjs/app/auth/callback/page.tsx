"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function AuthCallbackPage() {
  const [status, setStatus] = useState("Completing Google sign-in…");

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) {
      setStatus("Auth is not configured in this deployment.");
      return;
    }

    let cancelled = false;
    client.auth.getSession().then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data.session) {
        setStatus("Sign-in did not complete. Google testing-mode users only.");
        return;
      }
      window.location.replace("/workspace");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <header>
        <Link href="/" className="brand"><span>T</span>TAVONEL</Link>
      </header>
      <section className="hero">
        <div>
          <p className="eyebrow">● AUTH CALLBACK</p>
          <h1>Signing you in.</h1>
          <p className="lead" role="status">{status}</p>
          <p className="fine">Private-pilot intake and qualified GPU OCR are open. Candidate promotion stays closed.</p>
        </div>
      </section>
    </main>
  );
}
