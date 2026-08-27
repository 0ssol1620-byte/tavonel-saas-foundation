# TAVONEL Foundation Security Boundaries

This project is a separate SaaS foundation. It must not modify, deploy to, or receive secrets from the existing `tavonel` production application or the isolated CDR activation repository.

## Explicitly inactive capabilities

The current application may demonstrate user experience and server-side contracts, but it must not accept customer document bytes, initiate R2 uploads, call AV/CDR/OCR/GPU providers, dispatch GPU work, or promote a candidate knowledge graph. Every external operation remains fail-closed until sandbox qualification and a separate contextual approval are complete.

## External integration principles

Supabase Auth, Paddle, Cloudflare R2, and any CDR credentials must be configured through managed server-side secrets only. Browser code may hold a provider-designated publishable token when appropriate, but never service-role keys, webhook secrets, R2 credentials, CDR material, or signing credentials. The server must derive tenant identity from an authenticated session and never from a browser-supplied workspace identifier alone.

## Direct-upload boundary

Document bytes belong only in a tenant-scoped quarantine object store. The browser receives a narrowly scoped, short-lived upload capability only after server-side authentication, entitlement, and quota checks. Postgres stores metadata and immutable proof references; it never stores document bytes. Vercel server handlers coordinate contracts and never proxy large document bodies.

## CDR bootstrap boundary

The CDR bootstrap is outside this project. The prepared source is the existing restricted Seoul Developer Connect link, fixed activation commit, and verified committed bootstrap configuration. A future triggerless one-off build creates a regional runtime secret only after an explicit final confirmation. This SaaS foundation does not submit that build, attach any secret, or activate any CDR caller.
