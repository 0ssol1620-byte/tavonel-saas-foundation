import type { Metadata } from "next";
import V34Page from "@/components/v34/shell/v34-page";
import { ProgramBody } from "@/components/v34/routes/research-program/program";
import { routeViewport } from "@/lib/v34/route-metadata";

/*
  The research program, moved here from /research (which is now the researcher page). It is a live
  page with no registry row yet, so its metadata is written out here in the shape a registry row
  takes (a title of 50-60 characters ending " — TAVONEL", a description of 120-160 characters),
  and the frame takes the `research` shell so the header marks Research as current. When the row
  exists this file switches to routeMetadata, releaseGate and RouteJsonLd for it.
*/
export const metadata: Metadata = {
  alternates: { canonical: "/research/program" },
  openGraph: { url: "/research/program" },
  title: "Open problems in turning documents into knowledge — TAVONEL",
  description:
    "The open problems in compiling documents into evidence-bound, versioned knowledge: identity across documents, what supports a statement, what a change breaks.",
};
export const viewport = routeViewport();

export default function ResearchProgramPage() {
  return (
    <V34Page route="research">
      <ProgramBody />
    </V34Page>
  );
}
