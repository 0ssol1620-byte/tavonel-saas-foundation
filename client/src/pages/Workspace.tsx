import { trpc } from "@/lib/trpc";
import {
  ArrowUpRight,
  Bell,
  ChevronDown,
  FileText,
  FolderKanban,
  Grid2X2,
  HelpCircle,
  LineChart,
  LockKeyhole,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

const fallbackStates = [
  { capability: "customerIntake", enabled: false, reason: "Awaiting R2 synthetic qualification" },
  { capability: "cdr", enabled: false, reason: "Awaiting independently authenticated runtime" },
  { capability: "ocrGpu", enabled: false, reason: "Sanitized-only processing not yet qualified" },
  { capability: "candidatePromotion", enabled: false, reason: "Human review remains required" },
];

const navItems = [
  { icon: Grid2X2, label: "Overview", active: true },
  { icon: FileText, label: "Documents" },
  { icon: Sparkles, label: "Knowledge candidates" },
  { icon: LineChart, label: "Activity" },
];

export default function Workspace() {
  const [, navigate] = useLocation();
  const [notice, setNotice] = useState("Private pilot mode. No document bytes are accepted in this environment.");
  const { data: readiness } = trpc.foundation.activationReadiness.useQuery(undefined, {
    retry: false,
  });
  const states = readiness ?? fallbackStates;

  const showPausedNotice = () => {
    setNotice("Intake is intentionally paused. A tenant-scoped R2 upload capability is not issued until synthetic qualification and explicit activation approval.");
  };

  return (
    <div className="min-h-screen bg-[#f6f4ee] text-[#20342e]">
      <div className="flex min-h-screen">
        <aside className="hidden w-[246px] shrink-0 flex-col border-r border-[#dfe4db] bg-[#fbfaf7] px-4 py-5 lg:flex">
          <button onClick={() => navigate("/")} className="flex items-center gap-3 px-2 text-left" aria-label="Return to TAVONEL home">
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#223a32] text-xs font-semibold tracking-[0.18em] text-[#f5ead7]">T</span>
            <span className="font-serif text-xl tracking-[-0.04em] text-[#1d332d]">TAVONEL</span>
          </button>

          <div className="mt-10">
            <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8a9189]">Workspace</p>
            <button onClick={() => setNotice("Workspace switching will be available after Supabase Auth is connected.")} className="mt-3 flex w-full items-center justify-between rounded-xl border border-[#e0e5dc] bg-white px-3 py-3 text-left shadow-[0_2px_10px_rgba(27,49,42,0.04)]">
              <span>
                <span className="block text-sm font-medium text-[#253b34]">Private pilot</span>
                <span className="mt-0.5 block text-xs text-[#8a9189]">Foundation environment</span>
              </span>
              <ChevronDown className="h-4 w-4 text-[#8a9189]" />
            </button>
          </div>

          <nav className="mt-8 space-y-1" aria-label="Workspace navigation">
            {navItems.map(({ icon: Icon, label, active }) => (
              <button
                key={label}
                onClick={() => setNotice(`${label} is represented in the foundation UI. Live records remain unavailable until the tenant integrations are qualified.`)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${active ? "bg-[#e8eee5] font-medium text-[#203a31]" : "text-[#68756d] hover:bg-[#f0f2ec] hover:text-[#203a31]"}`}
              >
                <Icon className="h-[17px] w-[17px]" />
                {label}
              </button>
            ))}
          </nav>

          <div className="mt-auto space-y-1 border-t border-[#e6e8e2] pt-4">
            <button onClick={() => setNotice("Plan management will open the Paddle customer portal after a signed subscription entitlement exists.")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#68756d] hover:bg-[#f0f2ec]">
              <FolderKanban className="h-[17px] w-[17px]" /> Billing & plan
            </button>
            <button onClick={() => setNotice("Security documentation is prepared in this isolated foundation; no production controls are changed.")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#68756d] hover:bg-[#f0f2ec]">
              <ShieldCheck className="h-[17px] w-[17px]" /> Security
            </button>
            <button onClick={() => setNotice("Support routing is not configured in the private-pilot foundation.")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#68756d] hover:bg-[#f0f2ec]">
              <HelpCircle className="h-[17px] w-[17px]" /> Help
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="flex h-[76px] items-center justify-between border-b border-[#dfe4db] bg-[#fbfaf7]/85 px-5 backdrop-blur md:px-9">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate("/")} className="rounded-lg p-2 text-[#66726b] hover:bg-[#eef1eb] lg:hidden" aria-label="Go to home"><PanelLeft className="h-5 w-5" /></button>
              <div>
                <div className="flex items-center gap-2"><span className="text-sm font-medium">Private pilot</span><span className="h-1 w-1 rounded-full bg-[#b7a163]" /><span className="text-xs text-[#78827a]">Overview</span></div>
                <p className="mt-1 text-xs text-[#8b948d]">Your governed knowledge space</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setNotice("Search becomes available after sanitized document metadata is connected.")} className="hidden h-10 items-center gap-2 rounded-lg border border-[#e0e5dd] bg-white px-3 text-xs text-[#7b857d] md:flex"><Search className="h-4 w-4" /> Search anything <span className="rounded border border-[#e5e7e1] px-1.5 py-0.5 text-[10px]">⌘ K</span></button>
              <button onClick={() => setNotice("Notifications are quiet while private-pilot processing remains disabled.")} className="rounded-lg p-2 text-[#718078] hover:bg-[#eef1eb]" aria-label="Notifications"><Bell className="h-5 w-5" /></button>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#dce7dd] text-xs font-semibold text-[#385646]">PP</div>
            </div>
          </header>

          <div className="mx-auto max-w-[1320px] px-5 py-8 md:px-9 md:py-10">
            <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#ded6bc] bg-[#fcf8ed] px-3 py-1.5 text-[11px] font-medium text-[#766743]"><span className="h-1.5 w-1.5 rounded-full bg-[#a58c48]" /> FOUNDATION · SAFE MODE</p>
                <h1 className="font-serif text-4xl tracking-[-0.05em] text-[#20362f] md:text-5xl">A quieter place to think.</h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-[#6e7c73]">Build a traceable body of knowledge from documents that have passed the full safety chain. This private-pilot workspace is deliberately not accepting files yet.</p>
              </div>
              <button onClick={showPausedNotice} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#243e35] px-4 text-sm font-medium text-white shadow-[0_8px_20px_rgba(27,55,44,0.17)] transition hover:bg-[#1b332b] active:scale-[0.98]"><UploadCloud className="h-4 w-4" /> Upload document <LockKeyhole className="h-3.5 w-3.5 opacity-70" /></button>
            </div>

            <div className="mb-6 rounded-xl border border-[#e6dfc9] bg-[#fffaf0] px-4 py-3 text-sm text-[#695c3b] shadow-[0_4px_18px_rgba(86,70,31,0.04)]" role="status">
              <span className="mr-2 font-semibold">Guardrail active.</span>{notice}
            </div>

            <section className="grid gap-5 xl:grid-cols-[1.5fr_0.9fr]">
              <div className="rounded-2xl border border-[#dfe5dc] bg-[#fcfcf9] p-5 shadow-[0_8px_28px_rgba(31,52,43,0.05)] md:p-6">
                <div className="flex items-start justify-between">
                  <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8b948d]">Your library</p><h2 className="mt-2 font-serif text-2xl tracking-[-0.04em]">Awaiting a qualified first document</h2></div>
                  <button onClick={() => setNotice("Document actions are unavailable until browser-direct R2 intake is approved.")} className="rounded-lg p-2 text-[#839087] hover:bg-[#edf0e9]" aria-label="Document options"><MoreHorizontal className="h-5 w-5" /></button>
                </div>
                <div className="mt-8 flex min-h-[235px] flex-col items-center justify-center rounded-xl border border-dashed border-[#d6ddd4] bg-[#f7f8f4] px-6 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e7eee5] text-[#547460]"><FileText className="h-5 w-5" /></span>
                  <p className="mt-4 font-medium">No document metadata yet</p>
                  <p className="mt-1 max-w-sm text-sm leading-6 text-[#768178]">When qualification begins, only a short-lived browser-direct quarantine capability can be requested. Neither the application server nor the database carries the file bytes.</p>
                  <button onClick={showPausedNotice} className="mt-5 text-sm font-medium text-[#375b49] underline decoration-[#aebcad] underline-offset-4">Review upload safeguards</button>
                </div>
              </div>

              <div className="rounded-2xl bg-[#233d34] p-5 text-[#f5f1e8] shadow-[0_10px_30px_rgba(24,51,41,0.15)] md:p-6">
                <div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#bfcab9]">Knowledge canvas</p><h2 className="mt-2 font-serif text-2xl tracking-[-0.04em]">Candidate-only by design</h2></div><Sparkles className="h-5 w-5 text-[#ddc576]" /></div>
                <div className="mt-9 grid place-items-center py-3">
                  <div className="relative h-[128px] w-[210px]" aria-hidden="true">
                    <span className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#d8c26f]/80 bg-[#3c5f4d] shadow-[0_0_0_8px_rgba(241,219,142,0.07)]" />
                    <span className="absolute left-2 top-3 h-9 w-9 rounded-full border border-[#9cb39f]/50 bg-[#2d4d40]" /><span className="absolute right-1 top-6 h-11 w-11 rounded-full border border-[#9cb39f]/50 bg-[#2d4d40]" />
                    <span className="absolute bottom-0 left-7 h-10 w-10 rounded-full border border-[#9cb39f]/50 bg-[#2d4d40]" /><span className="absolute bottom-2 right-8 h-7 w-7 rounded-full border border-[#9cb39f]/50 bg-[#2d4d40]" />
                    <i className="absolute left-9 top-10 h-px w-20 rotate-[22deg] bg-[#95ae9b]/50" /><i className="absolute right-8 top-11 h-px w-20 -rotate-[22deg] bg-[#95ae9b]/50" /><i className="absolute bottom-8 left-12 h-px w-20 rotate-[22deg] bg-[#95ae9b]/50" />
                  </div>
                </div>
                <p className="mt-5 text-sm leading-6 text-[#c9d2c6]">Sanitized inputs can produce reviewable candidates. No candidate is promoted to a world without a separate human decision.</p>
                <button onClick={() => setNotice("Knowledge candidates appear only after sanitized-only qualification. Promotion is never automatic.")} className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-[#ecd98e] hover:text-white">How review works <ArrowUpRight className="h-4 w-4" /></button>
              </div>
            </section>

            <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.4fr]">
              <div className="rounded-2xl border border-[#dfe5dc] bg-[#fcfcf9] p-5 shadow-[0_8px_28px_rgba(31,52,43,0.05)] md:p-6">
                <div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8b948d]">Plan & quota</p><h2 className="mt-2 font-serif text-2xl tracking-[-0.04em]">Not yet entitled</h2></div><span className="rounded-full bg-[#eef0ec] px-2.5 py-1 text-[11px] font-medium text-[#778178]">Paddle pending</span></div>
                <div className="mt-7 space-y-5"><QuotaRow label="Document bytes" value="0 B / unavailable" /><QuotaRow label="Qualified documents" value="0 / unavailable" /></div>
                <button onClick={() => setNotice("Billing setup is intentionally connected only to Paddle sandbox first. No live checkout is enabled.")} className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-[#375b49] hover:text-[#1f3d30]"><Plus className="h-4 w-4" /> Explore pilot plans</button>
              </div>

              <div className="rounded-2xl border border-[#dfe5dc] bg-[#fcfcf9] p-5 shadow-[0_8px_28px_rgba(31,52,43,0.05)] md:p-6">
                <div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8b948d]">Processing integrity</p><h2 className="mt-2 font-serif text-2xl tracking-[-0.04em]">Four gates, all closed</h2></div><ShieldCheck className="h-5 w-5 text-[#66836f]" /></div>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  {states.map(state => <IntegrityState key={state.capability} label={state.capability} reason={state.reason} enabled={state.enabled} />)}
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

function QuotaRow({ label, value }: { label: string; value: string }) {
  return <div><div className="mb-2 flex items-center justify-between text-sm"><span className="text-[#657269]">{label}</span><span className="font-medium text-[#31463b]">{value}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#e8ece6]"><div className="h-full w-0 rounded-full bg-[#75927a]" /></div></div>;
}

function IntegrityState({ label, reason, enabled }: { label: string; reason: string; enabled: boolean }) {
  const title = label.replace(/([A-Z])/g, " $1").replace(/^./, char => char.toUpperCase());
  return <div className="rounded-xl border border-[#e6ebe3] bg-[#f8faf6] p-3"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${enabled ? "bg-[#5d9170]" : "bg-[#b9a66d]"}`} /><span className="text-sm font-medium text-[#33483d]">{title}</span></div><p className="mt-2 text-xs leading-5 text-[#7c877f]">{reason}</p></div>;
}
