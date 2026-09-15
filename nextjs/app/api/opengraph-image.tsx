import { ogCard } from "@/lib/og-card";

export { alt, contentType, size } from "@/lib/og-card";

/*
  `/api` is a 308 to `/docs` today and becomes the rendered API reference in this same release
  (devx lane, G3-004/G3-008). The card is written for the page it is becoming, because the entry
  it belongs to is in `app/sitemap.ts` on exactly that condition -- if the reference does not
  ship, the sitemap entry comes out and this file goes with it.
*/
export default ogCard("API reference", "Every operation, its parameters, its response shape and the error codes it can return.");
