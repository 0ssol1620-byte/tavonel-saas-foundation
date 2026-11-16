import type { V34RouteKey } from "@/lib/v34/routes";

/** The storyboard frames, in order. Each points at the live page that shows the real thing. */
export const FRAMES: readonly { label: string; text: string; route: V34RouteKey; link: string }[] = [
  { label: "Source files", text: "A folder of PDFs, spreadsheets and slides sits in one place.", route: "compiler", link: "See how the compiler reads files" },
  { label: "Compile", text: "Each file is read into records, and every record keeps the page and region it came from.", route: "methods", link: "See the methods" },
  { label: "Evidence", text: "A record opens onto its source page with the supporting region marked.", route: "evidence", link: "Open the evidence view" },
  { label: "A World", text: "Records and the relationships between them form a World that can be browsed.", route: "world", link: "Explore the reference World" },
  { label: "Change", text: "A new version of a source arrives and the changes view compares it with the version before.", route: "changes", link: "Compare two versions" },
  { label: "A cited answer", text: "An AI client asks a question over MCP and the answer comes back with the records it cites.", route: "connect", link: "Connect an AI client" },
];

export const FILM = {
  eyebrow: "Storyboard",
  lead: "Frames follow one document from a source file to a cited answer, with the page that shows each step.",
  frames: { title: "From a source file to a cited answer", lead: "Each frame names one step and links to the page where that step can be inspected." },
  final: "Compile your own documents into a World",
} as const;
