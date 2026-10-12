import type { Metadata } from "next";
import EvaluationPage from "@/components/evaluation-page";
import DocumentLangKo from "../document-lang";
export const metadata: Metadata = { title: "내 문서 평가 — TAVONEL", description: "사용 허가된 문서와 실제 업무 질문으로 평가 범위를 정합니다. 처리 위치, 보관 기간과 비용 상한을 합의한 뒤 원문 근거와 결과, 실패 및 남은 한계를 함께 검증합니다.", openGraph: { url: "/ko/evaluation" }, alternates: { canonical: "/ko/evaluation", languages: { en: "/evaluation", ko: "/ko/evaluation", "x-default": "/evaluation" } } };
export default function Page() { return <><DocumentLangKo /><EvaluationPage korean /></>; }
