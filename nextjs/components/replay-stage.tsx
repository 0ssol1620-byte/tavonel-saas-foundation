"use client";

/**
 * Compilation Replay — the directed 0–56s sequence, S00–S20.
 *
 * Rendering split follows SPEC §11.3: DOM carries typography, controls, the source browser and
 * the answer; SVG carries evidence, dependency and relations. There is no canvas and no WebGL —
 * decision G-C2 is unrecorded, so the spec's default applies and the 2D baseline must complete
 * the whole argument on its own.
 *
 * Every displayed count binds to `PROJECTION` (§3.3). No literal appears in this file.
 */

import { useMemo, useRef } from "react";
import {
  AFFECTED_COUNT, DATE_CANDIDATES, EVIDENCE, FEED, IDENTITY_CANDIDATES, IDENTITY_RESOLVED,
  IMPACT_PATH, PROJECTION, RAIL_STAGES, ROUTE_LABELS, SOURCES, SOURCE_GROUPS,
  WORLD_UNITS, CURRENT_AFTER, CURRENT_BEFORE,
} from "@/lib/cinematic/fixture";
import {
  ASK, BRAND, CHANGE, CTA, EVIDENCE_CLOSE, EXPLANATION, FIRST_PAYOFF, HANDOFF, OPENING,
  RECOMPILE, TIMELAPSE_STAGES,
} from "@/lib/cinematic/copy";
import {
  SEQUENCE_DURATION_SECONDS, SHOTS, shotAt, shotProgress, type ShotId,
} from "@/lib/cinematic/shots";
import { useDirector } from "@/lib/cinematic/use-director";

const nf = new Intl.NumberFormat("en-US");
const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);
/** Linear ramp between two times. Used for reading a value out of the clock, never to schedule. */
const ramp = (t: number, from: number, to: number) => clamp01((t - from) / (to - from));

function Ev() {
  return <span className="sg-ev" aria-hidden="true"><i /><i /><i /><i /></span>;
}

export default function ReplayStage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const { seconds: t, mode, reducedMotion, toggle, replay, skipToEnd, seek } = useDirector(stageRef);

  const shot = shotAt(t);
  const on = (...ids: ShotId[]) => (ids.includes(shot.id) ? 1 : 0);
  /** Mirror of `on` for the accessibility tree — an off scene is inert, not just transparent. */
  const off = (...ids: ShotId[]) => (ids.includes(shot.id) ? undefined : true);

  const visibleFeed = useMemo(() => FEED.filter((r) => r.at <= t).slice(-7).reverse(), [t]);
  const worldVersionState = t >= 36.8 ? "new" : t >= 32 ? "recompiling" : "stable";

  const filesFound = Math.round(PROJECTION.discovery.filesDiscovered * ramp(t, 1.45, 3.1));
  const entities = Math.round(PROJECTION.worldTotals.entities * ramp(t, 5.8, 10.1));
  const relations = Math.round(PROJECTION.worldTotals.relations * ramp(t, 10.1, 11.65));
  const impactHops = Math.floor(ramp(t, 29.4, 31.6) * IMPACT_PATH.length);
  const rebuilt = Math.round(AFFECTED_COUNT * ramp(t, 32.6, 35.4));

  return (
    <>
      <div className="stage" ref={stageRef} role="img" aria-label={`Compilation replay, ${shot.beat}. ${shot.takeaway}`}>
        {/* ------------------------------------------------------------ title bar */}
        <div className="titlebar">
          <span className="tb-brand">{BRAND.name}</span>
          <span className="tb-cat">{BRAND.category}</span>
          <span className="tb-right">
            <span className="tb-version" data-state={worldVersionState}>
              {worldVersionState === "new" ? PROJECTION.versions.after : PROJECTION.versions.before}
              {worldVersionState === "recompiling" ? " · RECOMPILING" : worldVersionState === "new" ? " · CURRENT" : " · CURRENT"}
            </span>
          </span>
        </div>

        <div className="stage-body">
          {/* ---------------------------------------------------------- source browser */}
          <aside className="browser">
            <h3>SOURCES</h3>
            {SOURCE_GROUPS.map((g, i) => (
              <div key={g} className="brow" data-in={t >= 0.65 + i * 0.12 ? 1 : 0}>
                <span className="g-folder" aria-hidden="true" />
                <span>{g}</span>
                <span className="count">{t >= 1.45 ? nf.format(Math.round(filesFound / SOURCE_GROUPS.length)) : "—"}</span>
              </div>
            ))}
            {SOURCES.slice(0, 6).map((s, i) => (
              <div
                key={s.id}
                className="brow"
                data-depth="1"
                data-in={t >= 1.1 + i * 0.09 ? 1 : 0}
                data-active={shot.id === "S04" && s.route === "ocr" ? 1 : 0}
              >
                <span className="g-doc" data-scan={s.route === "ocr" ? 1 : 0} aria-hidden="true" />
                <span>{s.name}</span>
              </div>
            ))}
          </aside>

          {/* ---------------------------------------------------------- main stage */}
          <div className="main-stage">
            {/* S00 — orientation */}
            <div className="scene" data-on={on("S00")} aria-hidden={off("S00")}>
              <div className="scene-pad center">
                <p className="stage-kicker">{BRAND.category}</p>
                <p className="stage-statement" style={{ textAlign: "center" }}>{OPENING}</p>
              </div>
            </div>

            {/* S01 — source connection */}
            <div className="scene" data-on={on("S01")} aria-hidden={off("S01")}>
              <div className="scene-pad" style={{ justifyContent: "center" }}>
                <p className="stage-kicker">{TIMELAPSE_STAGES[0]}</p>
                <p className="stage-statement">Folders, notes, code and cloud enter one world of material.</p>
              </div>
            </div>

            {/* S02 — discovery timelapse */}
            <div className="scene" data-on={on("S02")} aria-hidden={off("S02")}>
              <div className="scene-pad" style={{ justifyContent: "center" }}>
                <p className="stage-kicker">{TIMELAPSE_STAGES[0]}</p>
                <p className="stage-payoff" style={{ fontVariantNumeric: "tabular-nums" }}>{nf.format(filesFound)}</p>
                <p className="stage-sub">
                  sources across {PROJECTION.discovery.groups} groups and {PROJECTION.discovery.formats} formats, {PROJECTION.discovery.spanYears}
                </p>
              </div>
            </div>

            {/* S03 — classification stream */}
            <div className="scene" data-on={on("S03")} aria-hidden={off("S03")}>
              <div className="scene-pad">
                <p className="stage-kicker">CHOOSING A PROCESSING ROUTE</p>
                <div className="stream" style={{ marginTop: "calc(14 * var(--u))" }}>
                  {SOURCES.map((s, i) => (
                    <div key={s.id} className="card88" data-route={s.route} data-in={shotProgress(shot, t) > i / SOURCES.length ? 1 : 0}>
                      <span className="nm">{s.name}</span>
                      <span className="rt">{ROUTE_LABELS[s.route]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* S04 — OCR / structure read */}
            <div className="scene" data-on={on("S04")} aria-hidden={off("S04")}>
              <div className="scene-pad row" style={{ alignItems: "center", gap: "calc(28 * var(--u))" }}>
                <div className="sg-page">
                  <div className="pagelines">
                    {["", "mid", "short", "", "mid", "", "short", "mid"].map((c, i) => <i key={i} className={c} />)}
                  </div>
                  <div className="bbox" data-sel="1" style={{ left: "12%", top: "44%", width: "68%", height: "12%" }} />
                  <div className="bbox" style={{ left: "12%", top: "62%", width: "52%", height: "8%" }} />
                  <div className="scanline" style={{ top: `${8 + shotProgress(shot, t) * 84}%` }} />
                </div>
                <div className="col">
                  <p className="stage-kicker" style={{ margin: 0 }}>{TIMELAPSE_STAGES[1]}</p>
                  <p className="stage-sub" style={{ margin: 0 }}>
                    What was read stays bound to where it was found.
                  </p>
                  <div className="row" style={{ marginTop: "calc(8 * var(--u))" }}>
                    <Ev />
                    <span className="sg-claim">{EVIDENCE.locator}</span>
                  </div>
                  <p className="stage-sub" style={{ margin: 0, fontFamily: "var(--f-mono)", fontSize: "calc(11 * var(--u))" }}>
                    {nf.format(PROJECTION.read.scannedPages)} scanned pages · {nf.format(PROJECTION.read.regions)} regions
                  </p>
                </div>
              </div>
            </div>

            {/* S05 — semantic extraction */}
            <div className="scene" data-on={on("S05")} aria-hidden={off("S05")}>
              <div className="scene-pad" style={{ justifyContent: "center" }}>
                <p className="stage-kicker">{TIMELAPSE_STAGES[2]}</p>
                <div className="row" style={{ gap: "calc(26 * var(--u))", marginTop: "calc(10 * var(--u))" }}>
                  <div className="sg-doc" />
                  <div className="hoparrow" data-hit="1" />
                  <div className="col">
                    <span className="sg-entity">{IDENTITY_RESOLVED}</span>
                    <span className="sg-claim">{EVIDENCE.field}</span>
                    <span className="sg-claim sg-decision">Approved plan</span>
                  </div>
                </div>
              </div>
            </div>

            {/* S06 — stable identity convergence */}
            <div className="scene" data-on={on("S06")} aria-hidden={off("S06")}>
              <div className="scene-pad" style={{ justifyContent: "center" }}>
                <p className="stage-kicker">{TIMELAPSE_STAGES[2]}</p>
                <div className="row" style={{ gap: "calc(24 * var(--u))" }}>
                  <div className="col">
                    {IDENTITY_CANDIDATES.map((c, i) => (
                      <span
                        key={c}
                        className="sg-claim"
                        style={{
                          opacity: 1 - shotProgress(shot, t) * (i === 0 ? 0 : 0.72),
                          transform: `translateY(calc(${(1 - i) * (1 - shotProgress(shot, t)) * 18} * var(--u)))`,
                          transition: "transform var(--flow) var(--e-settle)",
                        }}
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                  <div className="hoparrow" data-hit={shotProgress(shot, t) > 0.4 ? 1 : 0} />
                  <span className="sg-entity sg-project" style={{ opacity: shotProgress(shot, t) > 0.4 ? 1 : 0.25 }}>
                    {IDENTITY_RESOLVED}
                  </span>
                </div>
                <p className="stage-sub">{nf.format(PROJECTION.identity.entitiesResolved)} entities resolved · {PROJECTION.identity.heldForReview} held for review</p>
              </div>
            </div>

            {/* S07 — authority + time resolution */}
            <div className="scene" data-on={on("S07")} aria-hidden={off("S07")}>
              <div className="scene-pad" style={{ justifyContent: "center" }}>
                <p className="stage-kicker">WHICH ANSWER GOVERNS</p>
                <div className="col" style={{ gap: "calc(9 * var(--u))" }}>
                  {DATE_CANDIDATES.map((c) => (
                    <span key={c.id} className="sg-claim" data-state={shotProgress(shot, t) > 0.45 ? c.state : undefined} style={{ minWidth: "calc(280 * var(--u))" }}>
                      <b style={{ fontWeight: 590, marginRight: "calc(10 * var(--u))" }}>{c.label}</b>
                      {c.origin}
                    </span>
                  ))}
                </div>
                <p className="stage-sub">A superseded fact is kept and marked, never deleted.</p>
              </div>
            </div>

            {/* S08 — dependency formation */}
            <div className="scene" data-on={on("S08")} aria-hidden={off("S08")}>
              <div className="scene-pad" style={{ justifyContent: "center" }}>
                <p className="stage-kicker">WHAT DEPENDS ON WHAT</p>
                <div className="hops">
                  {IMPACT_PATH.map((h, i) => (
                    <span key={h} style={{ display: "contents" }}>
                      {i > 0 ? <span className="hoparrow" data-hit={shotProgress(shot, t) > i / IMPACT_PATH.length ? 1 : 0} /> : null}
                      <span className="hop" data-hit={shotProgress(shot, t) > i / IMPACT_PATH.length ? 1 : 0}>{h}</span>
                    </span>
                  ))}
                </div>
                <p className="stage-sub">{nf.format(relations)} relations · {nf.format(entities)} entities</p>
              </div>
            </div>

            {/* S09 — projection flash */}
            <div className="scene" data-on={on("S09")} aria-hidden={off("S09")}>
              <div className="scene-pad" style={{ justifyContent: "center" }}>
                <p className="stage-kicker">ONE TRUTH, SEVERAL VIEWS</p>
                <div className="row">
                  <span className="sg-entity">Markdown</span>
                  <span className="sg-entity">Obsidian</span>
                  <span className="sg-entity">JSONL</span>
                  <span className="sg-consumer">agent</span>
                </div>
              </div>
            </div>

            {/* S10 — first world promotion (gate) */}
            <div className="scene" data-on={on("S10")} aria-hidden={off("S10")}>
              <div className="scene-pad" style={{ justifyContent: "center" }}>
                <p className="stage-kicker">{TIMELAPSE_STAGES[4]}</p>
                <p className="stage-payoff">{FIRST_PAYOFF.headline}</p>
                <p className="stage-sub">{FIRST_PAYOFF.lines.join(" ")}</p>
              </div>
            </div>

            {/* S11–S13 — explained intelligence */}
            <div className="scene" data-on={on("S11")} aria-hidden={off("S11")}>
              <div className="scene-pad" style={{ justifyContent: "center" }}>
                <p className="stage-kicker">EXPLAINED</p>
                <p className="stage-statement">{EXPLANATION[0]}</p>
                <div className="row" style={{ marginTop: "calc(14 * var(--u))" }}>
                  {IDENTITY_CANDIDATES.map((c) => <span key={c} className="sg-claim">{c}</span>)}
                  <div className="hoparrow" data-hit="1" />
                  <span className="sg-entity sg-project">{IDENTITY_RESOLVED}</span>
                </div>
              </div>
            </div>
            <div className="scene" data-on={on("S12")} aria-hidden={off("S12")}>
              <div className="scene-pad" style={{ justifyContent: "center" }}>
                <p className="stage-kicker">EXPLAINED</p>
                <p className="stage-statement">{EXPLANATION[1]}</p>
                <div className="col" style={{ marginTop: "calc(14 * var(--u))", gap: "calc(8 * var(--u))" }}>
                  {DATE_CANDIDATES.map((c) => (
                    <span key={c.id} className="sg-claim" data-state={c.state} style={{ minWidth: "calc(300 * var(--u))" }}>
                      <b style={{ fontWeight: 590, marginRight: "calc(10 * var(--u))" }}>{c.label}</b>
                      {c.origin} · {c.authority}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="scene" data-on={on("S13")} aria-hidden={off("S13")}>
              <div className="scene-pad" style={{ justifyContent: "center" }}>
                <p className="stage-kicker">EXPLAINED</p>
                <p className="stage-statement">{EXPLANATION[2]}</p>
                <div className="hops" style={{ marginTop: "calc(14 * var(--u))" }}>
                  {IMPACT_PATH.map((h, i) => (
                    <span key={h} style={{ display: "contents" }}>
                      {i > 0 ? <span className="hoparrow" data-hit="1" /> : null}
                      <span className="hop" data-hit="1">{h}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* S14 — authoritative source edit */}
            <div className="scene" data-on={on("S14")} aria-hidden={off("S14")}>
              <div className="scene-pad row" style={{ alignItems: "center", gap: "calc(26 * var(--u))" }}>
                <div className="sg-page" style={{ height: "calc(240 * var(--u))" }}>
                  <div className="pagelines">
                    {["", "mid", "", "short"].map((c, i) => <i key={i} className={c} />)}
                  </div>
                  <div className="bbox" data-sel="1" style={{ left: "10%", top: "40%", width: "72%", height: "14%" }} />
                </div>
                <div className="col">
                  <p className="stage-kicker" style={{ margin: 0 }}>{EVIDENCE.file}</p>
                  <p className="stage-statement" style={{ fontSize: "calc(30 * var(--u))", lineHeight: "calc(34 * var(--u))" }}>
                    {CHANGE}
                  </p>
                  <div className="row">
                    <span className="sg-claim" data-state="superseded">{EVIDENCE.field} · {CURRENT_BEFORE}</span>
                    <div className="hoparrow" data-hit="1" />
                    <span className="sg-claim" data-state="current">{EVIDENCE.field} · {CURRENT_AFTER}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* S15 — semantic diff + impact */}
            <div className="scene" data-on={on("S15")} aria-hidden={off("S15")}>
              <div className="scene-pad" style={{ justifyContent: "center" }}>
                <p className="stage-kicker">SEMANTIC CHANGE · VALUE · {impactHops} HOPS</p>
                <div className="hops">
                  {IMPACT_PATH.map((h, i) => (
                    <span key={h} style={{ display: "contents" }}>
                      {i > 0 ? <span className="hoparrow" data-hit={i < impactHops ? 1 : 0} /> : null}
                      <span className="hop" data-hit={i < impactHops ? 1 : 0}>{h}</span>
                    </span>
                  ))}
                </div>
                <p className="stage-sub">Not a character change. A meaning change, and everything that leans on it.</p>
              </div>
            </div>

            {/* S16 — selective recompilation (gate) */}
            <div className="scene" data-on={on("S16")} aria-hidden={off("S16")}>
              <div className="scene-pad">
                <p className="stage-kicker">{RECOMPILE.split("\n")[0]} <span style={{ color: "var(--ink-2)" }}>{RECOMPILE.split("\n")[1]}</span></p>
                <div className="worldgrid grow" style={{ alignContent: "start" }}>
                  {WORLD_UNITS.map((u) => (
                    <span
                      key={u.id}
                      className="wunit"
                      data-s={
                        !u.affected ? "inherited"
                          : rebuilt > WORLD_UNITS.filter((x) => x.affected && x.id <= u.id).length - 1 ? "rebuilt" : "dirty"
                      }
                    />
                  ))}
                </div>
                <p className="stage-sub" style={{ fontFamily: "var(--f-mono)", fontSize: "calc(12 * var(--u))" }}>
                  {nf.format(rebuilt)} of {nf.format(PROJECTION.recompile.worldUnitsTotal)} recompiled ·{" "}
                  {nf.format(PROJECTION.recompile.inherited)} inherited unchanged
                </p>
              </div>
            </div>

            {/* S17 — new world promotion */}
            <div className="scene" data-on={on("S17")} aria-hidden={off("S17")}>
              <div className="scene-pad" style={{ justifyContent: "center" }}>
                <p className="stage-kicker">VERIFIED, THEN ACTIVATED AT ONCE</p>
                <div className="row">
                  <span className="sg-claim" data-state="superseded">{PROJECTION.versions.before}</span>
                  <div className="hoparrow" data-hit="1" />
                  <span className="sg-claim sg-verified" data-state="current">{PROJECTION.versions.after}</span>
                </div>
                <p className="stage-sub">No partial world is ever shown as current.</p>
              </div>
            </div>

            {/* S18 — ask the current world */}
            <div className="scene" data-on={on("S18")} aria-hidden={off("S18")}>
              <div className="scene-pad" style={{ justifyContent: "center" }}>
                <div className="answer">
                  <p className="q">{ASK.question}</p>
                  <p className="a">{CURRENT_AFTER}</p>
                  <p className="st">CURRENT · APPROVED · EFFECTIVE</p>
                  <div className="meta">
                    <div><span className="sg-consumer">agent</span> reads the current world, not the file system</div>
                  </div>
                </div>
              </div>
            </div>

            {/* S19 — evidence return / facing pages (gate) */}
            <div className="scene" data-on={on("S19")} aria-hidden={off("S19")}>
              <div className="scene-pad">
                <p className="stage-kicker">{EVIDENCE_CLOSE}</p>
                <div className="facing">
                  <div className="side">
                    <div className="pagelines">
                      {["", "mid", "short", "", "mid", "", "short"].map((c, i) => <i key={i} className={c} />)}
                    </div>
                    <div className="bbox" data-sel="1" style={{ left: "10%", top: "46%", width: "70%", height: "10%" }} />
                    <span style={{ position: "absolute", left: "10%", bottom: "6%", fontFamily: "var(--f-mono)", fontSize: "calc(10 * var(--u))", color: "var(--ink-2)" }}>
                      {EVIDENCE.file} · {EVIDENCE.locator}
                    </span>
                  </div>
                  <div className="spine">
                    <i />
                    <svg className="thread" viewBox="0 0 40 300" preserveAspectRatio="none" aria-hidden="true">
                      <path d="M0 152 C 18 152, 22 96, 40 96" fill="none" stroke="var(--evidence)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                    </svg>
                  </div>
                  <div className="side" style={{ padding: "calc(16 * var(--u))" }}>
                    <p style={{ margin: 0, fontFamily: "var(--f-mono)", fontSize: "calc(10 * var(--u))", color: "var(--ink-2)", letterSpacing: ".1em" }}>COMPILED</p>
                    <div className="row" style={{ marginTop: "calc(14 * var(--u))" }}>
                      <Ev />
                      <span className="sg-claim" data-state="current">{EVIDENCE.field} · {CURRENT_AFTER}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* S20 — control handoff */}
            <div className="scene" data-on={on("S20")} aria-hidden={off("S20")}>
              <div className="scene-pad" style={{ justifyContent: "center" }}>
                <p className="stage-payoff" style={{ fontSize: "calc(40 * var(--u))", lineHeight: "calc(44 * var(--u))" }}>{HANDOFF}</p>
              </div>
              <div className="handoff">
                <h3>{HANDOFF}</h3>
                <div className="cta">
                  <a className="primary" href="#pricing">{CTA.primary}</a>
                  <a href="#argument">Read the whole sequence</a>
                  <a href="#proof">{CTA.tertiary}</a>
                </div>
              </div>
            </div>
          </div>

          {/* ---------------------------------------------------------- discovery feed */}
          <aside className="feed">
            <h3>EVENTS</h3>
            {visibleFeed.map((r) => (
              <div className="frow" key={`${r.at}-${r.verb}`} data-tone={r.tone}>
                <span className="fv">{r.verb}</span>
                <span className="fo">{r.object}</span>
              </div>
            ))}
          </aside>
        </div>

        {/* ------------------------------------------------------------ compiler rail */}
        <div className="rail">
          <div className="rail-macro">
            BUILDING A CURRENT WORLD
            <b>{shot.id} · {shot.beat}</b>
          </div>
          <div className="rail-track">
            {RAIL_STAGES.map((s) => {
              const p = ramp(t, s.from, s.to);
              const state = p >= 1 ? "done" : p > 0 ? "active" : "idle";
              return (
                <div className="rail-stage" key={s.id} data-state={state}>
                  <div className="bar"><i style={{ width: `${p * 100}%` }} /></div>
                  <div className="lab"><span>{s.id}</span></div>
                </div>
              );
            })}
          </div>
          <div className="rail-meso">
            {nf.format(entities)} / {nf.format(PROJECTION.worldTotals.entities)}
            <small>RESOLVE</small>
          </div>
        </div>
      </div>

      {/* -------------------------------------------------------------- transport */}
      <div className="transport">
        <span className="sample">{PROJECTION.label}</span>
        {reducedMotion ? (
          <span className="rm-note">Reduced motion is on — the sequence is settled on its final world. The full argument is written out below.</span>
        ) : (
          <>
            <button className="btn ghost small" onClick={toggle} aria-label={mode === "PLAYING" ? "Pause the replay" : "Play the replay"}>
              {mode === "PLAYING" ? "Pause" : mode === "ENDED" ? "Play again" : "Play"}
            </button>
            <button className="btn quiet small" onClick={skipToEnd}>Skip to current</button>
            <button className="btn quiet small" onClick={replay}>Replay 56s</button>
            <label className="scrub">
              <span className="visually-hidden" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                Scrub the replay
              </span>
              <input
                type="range" min={0} max={SEQUENCE_DURATION_SECONDS} step={0.05} value={t}
                onChange={(e) => seek(Number(e.target.value))}
              />
            </label>
            <span className="clock">{t.toFixed(2).padStart(5, "0")} / {SEQUENCE_DURATION_SECONDS.toFixed(2)}s</span>
          </>
        )}
      </div>
    </>
  );
}

export { SHOTS };
