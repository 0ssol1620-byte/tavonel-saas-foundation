import { v34Route, type V34RouteKey } from "@/lib/v34/routes";
import RouteJsonLd from "./shell/route-json-ld";
import V34Page from "./shell/v34-page";
import { Hero } from "./ui/hero";
import { Section } from "./ui/section";


/**
 * A route's page until its batch writes the real body: the V34 frame, the one h1 and lead from the
 * registry (the same words the metadata carries), and one plain line about what the page is for.
 * It is a real page, not a placeholder: it renders, it is indexable when the route is live, and a
 * route batch replaces this component with its own composition in `components/v34/routes/<key>/`.
 *
 * Release gating is not decided here. The page calls `releaseGate(key)` first, so a held route
 * answers 404 before this component renders and its words never leave the server.
 */
export default function RouteStub({ route, line }: { route: V34RouteKey; line: string }) {
  const record = v34Route(route);
  return (
    <V34Page route={route}>
      <RouteJsonLd route={route} />
      <Hero variant="sub" eyebrow={record.ogLabel} title={record.heading} lead={record.description} />
      <Section>
        <p>{line}</p>
      </Section>
    </V34Page>
  );
}
