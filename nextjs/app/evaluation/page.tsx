import type { Metadata } from "next";
import EvaluationPage from "@/components/evaluation-page";
export const metadata: Metadata = { title: "Evaluate your documents in a bounded pilot — TAVONEL", description: "Agree on a bounded document evaluation before processing begins: source permissions, real questions, limits, a total cost ceiling and how evidence is checked.", openGraph: { url: "/evaluation" }, alternates: { canonical: "/evaluation" } };
export default function Page() { return <EvaluationPage />; }
