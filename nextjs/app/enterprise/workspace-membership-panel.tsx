"use client";

/*
  UX19. Workspace membership and invitations, frontend only.

  Every value on screen comes from the members / invites routes or from the viewer's own session.
  Invite rows arrive as invite_id / invitee_email / state (snake_case) and are normalised once, on
  load, into this panel's id / email / status. Nothing is inferred into a better state than the
  fields support: an invitation is "pending" only while it is neither revoked nor accepted and its
  expiry is still ahead of local time, and a state this panel does not recognise is shown as-is,
  with no actions offered. The invitation token exists only in this
  component's memory, only for the response that created it -- it is never written to storage or
  the URL, and it cannot be fetched again.
*/
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Copy, UserPlus, Users } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type Member = { user_id: string; role: string; state: string; accepted_at: string | null; revoked_at: string | null };
type Invite = { id: string | null; email: string | null; role: string | null; status: string | null; invitedBy: string | null; createdAt: string | null; expiresAt: string | null; acceptedAt: string | null; revokedAt: string | null };
type Created = { email: string; role: string; expiresAt: string | null; token: string | null; delivery: string };
type InviteForm = { email: string; role: "member" | "admin"; expiresInHours: string };

const DEFAULT_FORM: InviteForm = { email: "", role: "member", expiresInHours: "72" };
const ASSIGNABLE_ROLES = ["member", "admin"] as const;
const KNOWN_INVITE_STATUSES = new Set(["pending", "accepted", "revoked", "expired"]);

class MembershipError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

async function getSession() {
  const client = getSupabaseBrowserClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session ?? null;
}

async function membershipFetch(path: string, init: RequestInit = {}) {
  const session = await getSession();
  if (!session?.access_token) throw new MembershipError(401, "AUTH_REQUIRED");
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${session.access_token}`);
  if (init.body) headers.set("content-type", "application/json");
  let response: Response;
  try { response = await fetch(path, { ...init, headers, cache: "no-store" }); }
  catch { throw new MembershipError(0, "NETWORK_UNAVAILABLE"); }
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new MembershipError(response.status, typeof body.code === "string" ? body.code : "REQUEST_FAILED");
  return body;
}

function describeError(cause: unknown, action: string): string {
  if (!(cause instanceof MembershipError)) return `${action} failed unexpectedly. Try again.`;
  const { status, code } = cause;
  const hint =
    status === 0 ? "The request did not reach the server. Check your connection and try again."
    : status === 401 ? "Your session is missing or expired. Sign in again, then retry."
    : status === 403 ? "Your workspace role does not allow this action. Ask a workspace owner."
    : status === 404 ? "The record was not found. Refresh the lists to see the current state."
    : status === 409 ? "It conflicts with the current state. Refresh the lists and review before retrying."
    : status === 400 || status === 422 ? "The server rejected these values. Check the fields and try again."
    : status === 429 ? "Too many requests. Wait a moment, then retry."
    : status >= 500 ? "The server could not complete it. Try again shortly."
    : "Try again.";
  return `${action} failed (${code}). ${hint}`;
}

function listFrom<T>(body: Record<string, unknown>, key: string): T[] {
  const value = body[key] ?? body.items;
  return Array.isArray(value) ? value as T[] : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

// The route returns invite_id / invitee_email / state; id / email / status are accepted as fallbacks
// only so a differently-shaped create response still renders what it does carry.
function normalizeInvite(raw: unknown): Invite {
  const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    id: text(row.invite_id) ?? text(row.id),
    email: text(row.invitee_email) ?? text(row.email),
    role: text(row.role),
    status: text(row.state) ?? text(row.status),
    invitedBy: text(row.invited_by),
    createdAt: text(row.created_at),
    expiresAt: text(row.expires_at),
    acceptedAt: text(row.accepted_at),
    revokedAt: text(row.revoked_at),
  };
}

function inviteStatus(invite: Invite, now: number): string {
  // A state this panel does not know is reported verbatim, never folded into a known one.
  if (invite.status && !KNOWN_INVITE_STATUSES.has(invite.status)) return invite.status;
  if (invite.status === "revoked" || invite.revokedAt) return "revoked";
  if (invite.status === "accepted" || invite.acceptedAt) return "accepted";
  const expiresAt = invite.expiresAt ? Date.parse(invite.expiresAt) : Number.NaN;
  if (invite.status === "expired" || (Number.isFinite(expiresAt) && expiresAt <= now)) return "expired";
  if (invite.status === "pending" && Number.isFinite(expiresAt)) return "pending";
  return invite.status ?? "unknown";
}

function When({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  const parsed = new Date(value);
  return <span>{label} <time dateTime={value}>{Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()}</time></span>;
}

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function WorkspaceMembershipPanel({ workspaceKey, workspaceName, viewerRole }: { workspaceKey: string; workspaceName: string; viewerRole: string | null }) {
  const isManager = viewerRole === "owner" || viewerRole === "admin";
  const isOwner = viewerRole === "owner";
  const base = `/api/workspaces/${encodeURIComponent(workspaceKey)}`;

  const [viewerId, setViewerId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [invitesError, setInvitesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});
  const [form, setForm] = useState<InviteForm>(DEFAULT_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const inFlight = useRef(false);
  const attempt = useRef<{ key: string; payload: string } | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const membersHeadingRef = useRef<HTMLHeadingElement>(null);
  const invitesHeadingRef = useRef<HTMLHeadingElement>(null);
  const createdRef = useRef<HTMLDivElement>(null);
  const expiryRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [membersResult, invitesResult] = await Promise.allSettled([
      membershipFetch(`${base}/members`),
      isManager ? membershipFetch(`${base}/invites`) : Promise.resolve(null),
    ]);
    if (membersResult.status === "fulfilled") { setMembers(listFrom<Member>(membersResult.value, "members")); setMembersError(null); }
    else setMembersError(describeError(membersResult.reason, "Loading members"));
    if (invitesResult.status === "fulfilled") { if (invitesResult.value) setInvites(listFrom<unknown>(invitesResult.value, "invites").map(normalizeInvite)); setInvitesError(null); }
    else setInvitesError(describeError(invitesResult.reason, "Loading invitations"));
    setNow(Date.now());
    setLoading(false);
  }, [base, isManager]);

  useEffect(() => {
    if (!viewerRole) return;
    void getSession().then((session) => setViewerId(session?.user.id ?? null));
    void load();
  }, [load, viewerRole]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => { if (created) createdRef.current?.focus(); }, [created]);

  async function run(key: string, action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setPending(key); setActionError(null);
    try { await action(); }
    finally { inFlight.current = false; setPending(null); }
  }

  function focusById(id: string, fallback: HTMLElement | null) {
    window.requestAnimationFrame(() => {
      const target = sectionRef.current?.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(id)}"]`);
      (target ?? fallback)?.focus();
    });
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = form.email.trim();
    const hours = Number(form.expiresInHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
      setFormError("Expiry must be a whole number of hours from 1 to 720.");
      expiryRef.current?.focus();
      return;
    }
    const role = form.role;
    const payload = JSON.stringify({ email, role, expiresInHours: hours });
    // A retry of the same values reuses the key so the server can replay it; changed values are a new request.
    if (!attempt.current || attempt.current.payload !== payload) attempt.current = { key: newKey(), payload };
    const idempotencyKey = attempt.current.key;
    await run("create", async () => {
      setFormError(null); setNotice(null); setCreated(null); setCopyState("idle");
      let body: Record<string, unknown>;
      try {
        body = await membershipFetch(`${base}/invites`, { method: "POST", headers: { "idempotency-key": idempotencyKey }, body: payload });
      } catch (cause) {
        setFormError(`${describeError(cause, "Creating the invitation")} Your entries are kept; retrying sends the same request.`);
        return;
      }
      // The create response's invite shape is not pinned down; whatever it omits falls back to what was entered.
      const invite = normalizeInvite(body.invite);
      const createdEmail = invite.email ?? email;
      attempt.current = null;
      setForm(DEFAULT_FORM);
      setCreated({
        email: createdEmail,
        role: invite.role ?? role,
        expiresAt: invite.expiresAt,
        token: text(body.token),
        delivery: text(body.delivery) ?? "manual",
      });
      setNotice(`Invitation created for ${createdEmail}.`);
      await load();
    });
  }

  async function copyToken(token: string) {
    try { await navigator.clipboard.writeText(token); setCopyState("copied"); }
    catch { setCopyState("failed"); }
  }

  async function saveRole(member: Member) {
    const role = roleDrafts[member.user_id];
    if (!role || role === member.role) return;
    await run(`role:${member.user_id}`, async () => {
      setNotice(null);
      try {
        await membershipFetch(`${base}/members/${encodeURIComponent(member.user_id)}`, { method: "PATCH", body: JSON.stringify({ role }) });
      } catch (cause) { setActionError(describeError(cause, "Changing the role")); return; }
      setRoleDrafts((drafts) => { const next = { ...drafts }; delete next[member.user_id]; return next; });
      setNotice(`Role for user ${member.user_id} changed to ${role}.`);
      await load();
    });
  }

  async function revokeMember(member: Member) {
    await run(`member:${member.user_id}`, async () => {
      setNotice(null);
      try {
        await membershipFetch(`${base}/members/${encodeURIComponent(member.user_id)}`, { method: "DELETE" });
      } catch (cause) { setActionError(describeError(cause, "Revoking the membership")); setConfirming(null); focusById(`member-revoke-${member.user_id}`, membersHeadingRef.current); return; }
      setConfirming(null);
      setNotice(`Membership for user ${member.user_id} revoked.`);
      await load();
      membersHeadingRef.current?.focus();
    });
  }

  async function revokeInvite(invite: Invite & { id: string }) {
    await run(`invite:${invite.id}`, async () => {
      setNotice(null);
      try {
        await membershipFetch(`${base}/invites/${encodeURIComponent(invite.id)}`, { method: "DELETE" });
      } catch (cause) { setActionError(describeError(cause, "Revoking the invitation")); setConfirming(null); focusById(`invite-revoke-${invite.id}`, invitesHeadingRef.current); return; }
      setConfirming(null);
      setNotice(`Invitation for ${invite.email ?? invite.id} revoked.`);
      await load();
      invitesHeadingRef.current?.focus();
    });
  }

  function cancelConfirm(focusId: string, fallback: HTMLElement | null) {
    setConfirming(null);
    focusById(focusId, fallback);
  }

  function updateForm(patch: Partial<InviteForm>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  const busy = pending !== null;

  return (
    <section ref={sectionRef} className="enterprise-section membership" aria-labelledby="membership-title" aria-busy={loading}>
      <div className="enterprise-section-title"><Users /><div><p>WORKSPACE ACCESS</p><h2 id="membership-title">Members & invitations</h2></div></div>

      {!viewerRole ? <p className="membership-empty">Your account holds no role in this workspace, so its membership is not shown.</p> : (
        <>
          <div className="membership-toolbar">
            <span className="membership-workspace">Workspace · <strong>{workspaceName}</strong> <code>{workspaceKey}</code></span>
            <span>Your role · <strong>{viewerRole}</strong></span>
            <button type="button" className="membership-button" onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh lists"}</button>
          </div>

          <div className="membership-live" role="status" aria-live="polite">{notice ? <p className="enterprise-notice">{notice}</p> : null}</div>
          {actionError ? <p className="enterprise-alert" role="alert">{actionError}</p> : null}

          <h3 ref={membersHeadingRef} tabIndex={-1} className="membership-heading">Members</h3>
          {membersError ? <p className="enterprise-alert" role="alert">{membersError}</p> : null}
          {members === null ? <p className="membership-empty">{membersError ? "Members could not be loaded." : "Loading members…"}</p>
            : members.length === 0 ? <p className="membership-empty">No members were returned for this workspace.</p> : (
            <ul className="membership-list" aria-label="Workspace members">
              {members.map((member) => {
                const isViewer = viewerId !== null && member.user_id === viewerId;
                const isOwnerRow = member.role === "owner";
                const active = member.state === "active";
                const canEditRole = isOwner && !isOwnerRow && active;
                const canRevoke = isManager && !isOwnerRow && active;
                const draft = roleDrafts[member.user_id] ?? member.role;
                const roleOptions: readonly string[] = ASSIGNABLE_ROLES.includes(member.role as typeof ASSIGNABLE_ROLES[number]) ? ASSIGNABLE_ROLES : [member.role, ...ASSIGNABLE_ROLES];
                return (
                  <li key={member.user_id} className="membership-row" data-state={member.state}>
                    <div className="membership-identity">
                      <span className="membership-label">User ID</span>
                      <code>{member.user_id}</code>
                      {isViewer ? <span className="membership-you">You</span> : null}
                    </div>
                    <dl className="membership-facts">
                      <div><dt>Role</dt><dd>{member.role}</dd></div>
                      <div><dt>State</dt><dd data-state={member.state}>{member.state}</dd></div>
                    </dl>
                    <p className="membership-dates"><When label="Joined" value={member.accepted_at} /><When label="Revoked" value={member.revoked_at} /></p>
                    {canEditRole || canRevoke ? (
                      <div className="membership-actions">
                        {canEditRole ? (
                          <>
                            <label className="membership-select">
                              <span>Change role for user {member.user_id}</span>
                              <select value={draft} disabled={busy} onChange={(event) => setRoleDrafts((drafts) => ({ ...drafts, [member.user_id]: event.target.value }))}>
                                {roleOptions.map((role) => <option key={role} value={role} disabled={!ASSIGNABLE_ROLES.includes(role as typeof ASSIGNABLE_ROLES[number])}>{role}</option>)}
                              </select>
                            </label>
                            <button type="button" className="membership-button" disabled={busy || draft === member.role} onClick={() => void saveRole(member)}>
                              {pending === `role:${member.user_id}` ? "Saving…" : "Save role"}
                            </button>
                          </>
                        ) : null}
                        {canRevoke ? (confirming === `member:${member.user_id}` ? (
                          <span className="membership-confirm" role="group" aria-label={`Confirm revoking user ${member.user_id}`}>
                            <button type="button" className="membership-button membership-danger" autoFocus disabled={busy} onClick={() => void revokeMember(member)}>
                              {pending === `member:${member.user_id}` ? "Revoking…" : "Confirm revoke"}
                            </button>
                            <button type="button" className="membership-button" disabled={busy} onClick={() => cancelConfirm(`member-revoke-${member.user_id}`, membersHeadingRef.current)}>Cancel</button>
                          </span>
                        ) : (
                          <button type="button" className="membership-button" data-focus-id={`member-revoke-${member.user_id}`} disabled={busy} aria-label={`Revoke membership for user ${member.user_id}`} onClick={() => setConfirming(`member:${member.user_id}`)}>Revoke</button>
                        )) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {isManager ? (
            <>
              <h3 ref={invitesHeadingRef} tabIndex={-1} className="membership-heading">Invitations</h3>
              <form className="membership-form" onSubmit={(event) => void createInvite(event)} aria-describedby="invite-delivery-note">
                <label>Email<input type="email" required autoComplete="off" value={form.email} onChange={(event) => updateForm({ email: event.target.value })} /></label>
                <label>Role<select aria-label="Invitation role" value={form.role} onChange={(event) => updateForm({ role: event.target.value as InviteForm["role"] })}>{ASSIGNABLE_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
                <label>Expires in, hours<input ref={expiryRef} type="number" required min={1} max={720} step={1} inputMode="numeric" value={form.expiresInHours} aria-invalid={formError?.startsWith("Expiry") || undefined} onChange={(event) => updateForm({ expiresInHours: event.target.value })} /></label>
                <button type="submit" className="enterprise-primary" disabled={busy}><UserPlus size={15} /> {pending === "create" ? "Creating…" : "Create invitation"}</button>
                <p id="invite-delivery-note" className="membership-note">Delivery is manual: no email is sent. The token is shown once, here, after creation — pass it to the invitee yourself.</p>
              </form>
              {formError ? <p className="enterprise-alert" role="alert">{formError}</p> : null}

              {created ? (
                <div ref={createdRef} tabIndex={-1} className="membership-created" aria-labelledby="membership-created-title">
                  <h4 id="membership-created-title">Invitation created for {created.email}</h4>
                  <p>Role {created.role}{created.expiresAt ? <> · <When label="expires" value={created.expiresAt} /></> : null} · delivery {created.delivery}</p>
                  {created.token ? (
                    <>
                      <label className="membership-token">Invitation token<input readOnly value={created.token} onFocus={(event) => event.currentTarget.select()} /></label>
                      <div className="membership-actions">
                        <button type="button" className="membership-button" onClick={() => void copyToken(created.token!)}><Copy size={14} /> Copy token</button>
                        <button type="button" className="membership-button" onClick={() => { setCreated(null); invitesHeadingRef.current?.focus(); }}>Done — hide token</button>
                      </div>
                      <p className="membership-note" role="status">{copyState === "copied" ? "Token copied to the clipboard." : copyState === "failed" ? "Copy was blocked. Select the token field and copy it manually." : "This token will not be shown again once hidden or after leaving this page."}</p>
                    </>
                  ) : <p className="membership-note">The server returned no token for this invitation. It cannot be delivered from here; revoke it and create a new one if needed.</p>}
                </div>
              ) : null}

              {invitesError ? <p className="enterprise-alert" role="alert">{invitesError}</p> : null}
              {invites === null ? <p className="membership-empty">{invitesError ? "Invitations could not be loaded." : "Loading invitations…"}</p>
                : invites.length === 0 ? <p className="membership-empty">No invitations have been created for this workspace.</p> : (
                <ul className="membership-list" aria-label="Workspace invitations">
                  {invites.map((invite, index) => {
                    const status = inviteStatus(invite, now);
                    const id = invite.id;
                    const label = invite.email ?? id ?? "an unidentified invitee";
                    return (
                      <li key={id ?? `row-${index}`} className="membership-row" data-status={status}>
                        <div className="membership-identity"><span className="membership-label">Email</span><span className="membership-email">{invite.email ?? "Not returned"}</span></div>
                        <dl className="membership-facts">
                          <div><dt>Role</dt><dd>{invite.role ?? "Not returned"}</dd></div>
                          <div><dt>Status</dt><dd data-status={status}>{status}</dd></div>
                        </dl>
                        <p className="membership-dates">
                          <When label="Created" value={invite.createdAt} />
                          <When label={status === "expired" ? "Expired" : "Expires"} value={invite.expiresAt} />
                          <When label="Accepted" value={invite.acceptedAt} />
                          <When label="Revoked" value={invite.revokedAt} />
                          {invite.invitedBy ? <span>Invited by user <code>{invite.invitedBy}</code></span> : null}
                        </p>
                        {status === "pending" && id ? (
                          <div className="membership-actions">
                            {confirming === `invite:${id}` ? (
                              <span className="membership-confirm" role="group" aria-label={`Confirm revoking the invitation for ${label}`}>
                                <button type="button" className="membership-button membership-danger" autoFocus disabled={busy} onClick={() => void revokeInvite({ ...invite, id })}>
                                  {pending === `invite:${id}` ? "Revoking…" : "Confirm revoke"}
                                </button>
                                <button type="button" className="membership-button" disabled={busy} onClick={() => cancelConfirm(`invite-revoke-${id}`, invitesHeadingRef.current)}>Cancel</button>
                              </span>
                            ) : (
                              <button type="button" className="membership-button" data-focus-id={`invite-revoke-${id}`} disabled={busy} aria-label={`Revoke invitation for ${label}`} onClick={() => setConfirming(`invite:${id}`)}>Revoke invitation</button>
                            )}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          ) : <p className="membership-note">Invitations are managed by workspace owners and admins.</p>}
        </>
      )}
    </section>
  );
}
