"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Status = { selfService?: boolean; liveCheckout?: boolean };

export default function PublicPrimaryCta({ className = "btn small" }: { className?: string }) {
  const [state, setState] = useState<"checking" | "self-service" | "contact">("checking");

  useEffect(() => {
    let current = true;
    void fetch("/api/status", { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as Status : null)
      .then((status) => {
        if (!current) return;
        setState(status?.selfService ? "self-service" : "contact");
      })
      .catch(() => { if (current) setState("contact"); });
    return () => { current = false; };
  }, []);

  if (state === "self-service") return <Link className={className} href="/login">Start free</Link>;
  if (state === "contact") return <Link className={className} href="/contact">Contact</Link>;
  return <Link className={className} href="/login" aria-label="Checking available access">Get started</Link>;
}
