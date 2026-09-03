import HomePageClient from "@/components/home-page-client";
import { isLiveCommerce } from "@/lib/commercial-state";

/**
 * The compile cuts moved into `CompileStagePlayer`, which owns all four of them.
 *
 * This file used to server-render cut 1 as a `FilmBand` so its markup was in the initial HTML,
 * dating from when that cut sat in the hero. It has not been the hero for some time — it was the
 * first of four bands stacked inside scene 3, three screens down — so the server render and the
 * high-priority preload beside it were buying nothing: a visitor's first paint is the headline,
 * and the film was being fetched at high priority before the fonts for text they could see.
 *
 * The only thing this page still decides is whether there is a checkout to send anyone to, which
 * it can read directly and a client component cannot.
 */
export default function HomePage() {
  return <HomePageClient liveCommerce={isLiveCommerce()} />;
}
