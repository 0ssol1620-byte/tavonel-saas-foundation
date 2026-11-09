import type { Metadata } from "next";
import EvaluationPage from "@/components/evaluation-page";
export const metadata: Metadata = { title: "Evaluate your documents — TAVONEL", description: "Agree on a bounded document evaluation: permissions, questions, limits, costs and evidence quality before processing begins.", openGraph: { url: "/evaluation" }, alternates: { canonical: "/evaluation" } };
export default function Page() { return <EvaluationPage />; }
