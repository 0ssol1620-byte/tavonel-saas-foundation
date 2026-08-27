import { Check, ChevronRight, CircleDashed, FileLock2, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

const plans = [
  { name: "Observer", description: "For a considered first step.", monthly: "$29", annual: "$24", features: ["1 private workspace", "Guided document quotas", "Candidate-only knowledge canvas"] },
  { name: "Studio", description: "For teams building a governed corpus.", monthly: "$99", annual: "$82", featured: true, features: ["Everything in Observer", "Shared workspace controls", "Expanded processing quotas"] },
  { name: "Institution", description: "For policy-led knowledge operations.", monthly: "Talk to us", annual: "Talk to us", features: ["Everything in Studio", "Custom governance policies", "Dedicated implementation review"] },
];

export default function Home() {
  const [, navigate] = useLocation();
  const [annual, setAnnual] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 5000);
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[#f7f5ef] text-[#20372f]">
      <header className="relative z-20 mx-auto flex max-w-[1240px] items-center justify-between px-5 py-5 md:px-8">
        <button onClick={() => navigate("/")} className="flex items-center gap-3" aria-label="TAVONEL home"><span className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-[#223a32] text-xs font-semibold tracking-[0.2em] text-[#f7edd6]">T</span><span className="font-serif text-2xl tracking-[-0.06em]">TAVONEL</span></button>
        <nav className="hidden items-center gap-8 text-sm text-[#69776e] md:flex" aria-label="Main navigation"><a href="#method" className="hover:text-[#1f3b30]">Method</a><a href="#pricing" className="hover:text-[#1f3b30]">Pricing</a><button onClick={() => notify("Security review stays visible while live intake remains disabled.")} className="hover:text-[#1f3b30]">Security</button></nav>
        <div className="flex items-center gap-3"><button onClick={() => setAuthOpen(true)} className="hidden text-sm font-medium text-[#344e42] hover:text-[#152d24] sm:inline">Sign in</button><button onClick={() => setAuthOpen(true)} className="rounded-lg bg-[#233d34] px-4 py-2.5 text-sm font-medium text-white shadow-[0_7px_16px_rgba(30,57,45,0.13)] transition hover:bg-[#183229] active:scale-[0.98]">Join private pilot</button></div>
      </header>

      <main>
        <section className="relative mx-auto max-w-[1240px] px-5 pb-20 pt-14 md:px-8 md:pb-28 md:pt-24">
          <div className="absolute -right-32 top-4 h-[420px] w-[420px] rounded-full bg-[#dce5d7]/70 blur-3xl" /><div className="absolute -left-48 bottom-4 h-[300px] w-[300px] rounded-full bg-[#f0e5c9]/80 blur-3xl" />
          <div className="relative grid items-center gap-14 lg:grid-cols-[1.08fr_0.92fr]">
            <div><p className="inline-flex items-center gap-2 rounded-full border border-[#ded6bc] bg-[#fcf9ed] px-3 py-1.5 text-[11px] font-semibold tracking-[0.09em] text-[#786942]"><span className="h-1.5 w-1.5 rounded-full bg-[#b09445]" /> PRIVATE PILOT FOUNDATION</p><h1 className="mt-7 max-w-[680px] font-serif text-[3.45rem] leading-[0.96] tracking-[-0.065em] text-[#1c352c] sm:text-7xl">Knowledge, kept <em className="font-normal text-[#5d7968]">whole.</em></h1><p className="mt-7 max-w-xl text-[17px] leading-8 text-[#627168]">TAVONEL turns qualified documents into a deliberate, reviewable knowledge system. Every meaningful transformation is governed; every result retains its lineage.</p><div className="mt-9 flex flex-col gap-3 sm:flex-row"><button onClick={() => setAuthOpen(true)} className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#233d34] px-5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(30,57,45,0.16)] transition hover:bg-[#183229] active:scale-[0.98]">Request private-pilot access <ChevronRight className="h-4 w-4" /></button><button onClick={() => navigate("/workspace")} className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-[#ced8ce] bg-white/70 px-5 text-sm font-semibold text-[#355347] transition hover:border-[#aebcad] hover:bg-white">Explore the foundation <ChevronRight className="h-4 w-4" /></button></div><p className="mt-5 flex items-center gap-2 text-xs text-[#7b877d]"><ShieldCheck className="h-4 w-4 text-[#66836f]" /> No document bytes are accepted during foundation mode.</p></div>
            <div className="relative mx-auto w-full max-w-[490px]"><div className="absolute inset-8 rounded-[32px] bg-[#cbdacb]/60 blur-2xl" /><div className="relative rounded-[26px] border border-white/80 bg-[#fdfcf8]/90 p-5 shadow-[0_25px_70px_rgba(44,67,56,0.16)] backdrop-blur"><div className="flex items-center justify-between border-b border-[#e6e9e3] pb-4"><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#bcae77]" /><span className="text-xs font-medium text-[#657168]">Knowledge integrity chain</span></div><CircleDashed className="h-4 w-4 text-[#7e9385]" /></div><div className="space-y-3 py-5"><FlowCard number="01" title="Quarantine" text="Browser-direct, tenant-scoped intake" kind="closed" /><FlowCard number="02" title="Sanitize" text="AV and mandatory CDR evidence" kind="closed" /><FlowCard number="03" title="Understand" text="Sanitized-only candidate analysis" kind="closed" /><FlowCard number="04" title="Review" text="Human decision before promotion" kind="open" /></div><div className="rounded-xl bg-[#edf3ea] px-4 py-3"><p className="text-xs leading-5 text-[#496454]"><strong className="font-semibold">Designed to fail closed.</strong> The workflow opens only after each prior control is qualified.</p></div></div></div>
          </div>
        </section>

        <section id="method" className="border-y border-[#dfe4db] bg-[#fbfaf6] py-20 md:py-28"><div className="mx-auto max-w-[1240px] px-5 md:px-8"><div className="grid gap-9 lg:grid-cols-[0.75fr_1.25fr]"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#869188]">A considered method</p><h2 className="mt-4 font-serif text-4xl tracking-[-0.055em] text-[#21382f]">The source deserves a boundary.</h2></div><div className="grid gap-px overflow-hidden rounded-2xl border border-[#dfe5dc] bg-[#dfe5dc] sm:grid-cols-2"><MethodCell icon={FileLock2} title="Intentional intake" text="Large documents bypass the application and database. Metadata and permissions remain tenant-scoped." /><MethodCell icon={ShieldCheck} title="Evidence before insight" text="A file must pass its safety chain before it can become a source for any candidate." /><MethodCell icon={Sparkles} title="Candidate, not conclusion" text="Automated analysis makes a reviewable proposal, never an unattended world." /><MethodCell icon={Check} title="A visible lineage" text="Every canonical artifact retains an immutable sanitization proof and clear provenance." /></div></div></div></section>

        <section id="pricing" className="mx-auto max-w-[1240px] px-5 py-20 md:px-8 md:py-28"><div className="flex flex-col justify-between gap-6 md:flex-row md:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#869188]">Measured access</p><h2 className="mt-4 font-serif text-5xl tracking-[-0.06em] text-[#21382f]">Plans for serious work.</h2><p className="mt-4 max-w-2xl text-sm leading-6 text-[#6d7a71]">Prices are presentation-only until Paddle sandbox, signature verification, and entitlement projection have been qualified.</p></div><div className="flex w-fit rounded-lg border border-[#d8dfd6] bg-[#fbfcf9] p-1 text-sm"><button onClick={() => setAnnual(false)} className={`rounded-md px-3 py-2 transition ${!annual ? "bg-[#233d34] text-white shadow-sm" : "text-[#718077]"}`}>Monthly</button><button onClick={() => setAnnual(true)} className={`rounded-md px-3 py-2 transition ${annual ? "bg-[#233d34] text-white shadow-sm" : "text-[#718077]"}`}>Annual <span className="ml-1 text-[10px] opacity-75">save 17%</span></button></div></div>
          <div className="mt-10 grid gap-5 lg:grid-cols-3">{plans.map(plan => <article key={plan.name} className={`relative rounded-2xl border p-6 ${plan.featured ? "border-[#2d4b3d] bg-[#273f36] text-[#f6f2e8] shadow-[0_18px_38px_rgba(31,54,43,0.16)]" : "border-[#dfe5dc] bg-[#fcfcf9] text-[#263c33]"}`}>{plan.featured && <span className="absolute -top-3 left-6 rounded-full bg-[#dbc56f] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#344335]">Private pilot choice</span>}<h3 className="font-serif text-3xl tracking-[-0.04em]">{plan.name}</h3><p className={`mt-2 text-sm ${plan.featured ? "text-[#c8d3c7]" : "text-[#748178]"}`}>{plan.description}</p><div className="mt-7 flex items-baseline gap-1"><span className="font-serif text-4xl tracking-[-0.05em]">{annual ? plan.annual : plan.monthly}</span>{plan.monthly.startsWith("$") && <span className={`text-sm ${plan.featured ? "text-[#c8d3c7]" : "text-[#748178]"}`}>/ month</span>}</div><button onClick={() => notify(`${plan.name} is held in presentation mode. A signed Paddle sandbox entitlement is required before checkout can be opened.`)} className={`mt-7 flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold transition active:scale-[0.98] ${plan.featured ? "bg-[#f7f1de] text-[#284538] hover:bg-white" : "border border-[#cad6ca] bg-white text-[#355447] hover:border-[#aebead]"}`}>{plan.name === "Institution" ? "Start a conversation" : "Choose this plan"}<ChevronRight className="h-4 w-4" /></button><ul className="mt-7 space-y-3 border-t border-current/10 pt-6">{plan.features.map(feature => <li key={feature} className={`flex gap-2 text-sm ${plan.featured ? "text-[#e0e7dd]" : "text-[#59685f]"}`}><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#86a38b]" />{feature}</li>)}</ul></article>)}</div>
        </section>
        <section className="border-t border-[#dfe4db] bg-[#eef2e9] px-5 py-20 md:px-8 md:py-24">
          <div className="mx-auto max-w-[1240px]">
            <div className="grid gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-end">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#758178]">Deliberate compute</p>
                <h2 className="mt-4 max-w-md font-serif text-4xl tracking-[-0.055em] text-[#21382f]">Access is steady. GPU work is measured.</h2>
                <p className="mt-4 max-w-md text-sm leading-6 text-[#66746a]">Credits keep GPU use bounded by design. They are reserved before a qualified job, settled against measured runtime, and never created by a checkout redirect.</p>
              </div>
              <CreditPacks onChoose={pack => notify(`${pack} is staged for Paddle sandbox only. No payment session or GPU capacity is created in foundation mode.`)} />
            </div>
            <p className="mt-6 text-xs text-[#758178]">No unlimited GPU plans. Hard job and workspace caps remain active even after a future credit purchase.</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#dfe4db] bg-[#fbfaf6]"><div className="mx-auto flex max-w-[1240px] flex-col justify-between gap-3 px-5 py-7 text-xs text-[#7d887f] sm:flex-row md:px-8"><p>© 2026 TAVONEL. A governed knowledge foundation.</p><p>Private pilot · no live document intake</p></div></footer>

      {notice && <div className="fixed bottom-5 left-1/2 z-50 w-[calc(100%-2.5rem)] max-w-xl -translate-x-1/2 rounded-xl border border-[#d8e1d5] bg-[#fcfdf9] px-4 py-3 text-sm leading-5 text-[#40594b] shadow-[0_14px_36px_rgba(26,49,40,0.17)]" role="status">{notice}</div>}
      {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} onNotify={notify} />}
    </div>
  );
}

function FlowCard({ number, title, text, kind }: { number: string; title: string; text: string; kind: "closed" | "open" }) {
  return <div className="flex items-center gap-3 rounded-xl border border-[#e5e9e1] bg-white px-3 py-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#edf2e9] text-[10px] font-semibold text-[#5c7865]">{number}</span><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-[#31493e]">{title}</p><p className="mt-0.5 truncate text-xs text-[#839087]">{text}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${kind === "open" ? "bg-[#e9f0e7] text-[#55725e]" : "bg-[#fbf1da] text-[#967b38]"}`}>{kind === "open" ? "review" : "held"}</span></div>;
}

function MethodCell({ icon: Icon, title, text }: { icon: typeof FileLock2; title: string; text: string }) {
  return <div className="bg-[#fbfaf6] p-6 md:p-7"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e9f0e7] text-[#55745f]"><Icon className="h-5 w-5" /></span><h3 className="mt-5 font-serif text-2xl tracking-[-0.035em] text-[#2a4036]">{title}</h3><p className="mt-2 text-sm leading-6 text-[#728077]">{text}</p></div>;
}

function CreditPacks({ onChoose }: { onChoose: (pack: string) => void }) {
  const packs = [
    { name: "Starter", price: "$12", credits: "100 credits", accent: false },
    { name: "Builder", price: "$30", credits: "300 credits", accent: true },
    { name: "Scale", price: "$75", credits: "800 credits", accent: false },
  ];
  return <div className="grid gap-3 sm:grid-cols-3">{packs.map(pack => <article key={pack.name} className={`rounded-2xl border p-5 ${pack.accent ? "border-[#345548] bg-[#29453a] text-[#f8f4e8] shadow-[0_12px_24px_rgba(35,61,52,0.13)]" : "border-[#dbe3d9] bg-[#fafbf8] text-[#284137]"}`}><p className={`text-[11px] font-semibold uppercase tracking-[0.15em] ${pack.accent ? "text-[#cbd8c8]" : "text-[#829087]"}`}>Prepaid capacity</p><h3 className="mt-4 font-serif text-3xl tracking-[-0.045em]">{pack.name}</h3><div className="mt-5 flex items-end justify-between"><span className="font-serif text-4xl tracking-[-0.06em]">{pack.price}</span><span className={`mb-1 text-xs ${pack.accent ? "text-[#dce5d9]" : "text-[#6c7b71]"}`}>{pack.credits}</span></div><button onClick={() => onChoose(pack.name)} className={`mt-5 w-full rounded-lg py-2.5 text-sm font-semibold transition active:scale-[0.98] ${pack.accent ? "bg-[#f4eedb] text-[#284538] hover:bg-white" : "border border-[#cad6ca] bg-white text-[#355447] hover:border-[#aebead]"}`}>Preview pack</button></article>)}</div>;
}

function AuthDialog({ onClose, onNotify }: { onClose: () => void; onNotify: (message: string) => void }) {
  const [email, setEmail] = useState("");
  const submit = (mode: "email" | "google") => {
    onClose();
    onNotify(mode === "email" && email ? "Signup is safely staged. Configure the dedicated Supabase project before sending an authentication email." : "Google OAuth is represented in the foundation only. A dedicated Supabase client and approved redirect URI are required before live sign-in.");
  };
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#13271f]/35 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="auth-title"><div className="w-full max-w-md rounded-2xl border border-white/70 bg-[#fcfcf8] p-6 shadow-[0_24px_70px_rgba(19,39,31,0.26)]"><button onClick={onClose} className="float-right text-sm text-[#78857c] hover:text-[#243d32]" aria-label="Close">Close</button><p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[#89938a]">Private pilot</p><h2 id="auth-title" className="mt-3 font-serif text-3xl tracking-[-0.05em]">Begin with a secure identity.</h2><p className="mt-3 text-sm leading-6 text-[#718077]">The interface is ready; authentication is intentionally not connected until the dedicated Supabase project and redirect settings are approved.</p><label className="mt-6 block text-xs font-semibold text-[#526259]">Work email<input value={email} onChange={event => setEmail(event.target.value)} type="email" placeholder="you@company.com" className="mt-2 h-11 w-full rounded-lg border border-[#d8e0d6] bg-white px-3 text-sm outline-none transition placeholder:text-[#a3aaa3] focus:border-[#75927a] focus:ring-4 focus:ring-[#dce8dc]" /></label><button onClick={() => submit("email")} className="mt-4 h-11 w-full rounded-lg bg-[#233d34] text-sm font-semibold text-white transition hover:bg-[#183229]">Continue with email</button><div className="my-4 flex items-center gap-3 text-[11px] text-[#9aa39c]"><span className="h-px flex-1 bg-[#e1e6df]" />or<span className="h-px flex-1 bg-[#e1e6df]" /></div><button onClick={() => submit("google")} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#d8e0d6] bg-white text-sm font-semibold text-[#3e5147] transition hover:bg-[#f7f9f5]"><span className="text-base font-bold text-[#5e7767]">G</span> Continue with Google</button></div></div>;
}
