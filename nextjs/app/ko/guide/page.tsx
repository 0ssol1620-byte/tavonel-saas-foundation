import type { Metadata } from "next";
import { GuidePage } from "@/components/guide/guide-page";
import { pageMetadata } from "@/lib/page-seo";

/* EN-1. 제품 가이드의 한국어판. 문장은 `lib/guide-content.ts`의 KO, 영문판을 그대로 옮긴 번역이다(D12). */
export const metadata: Metadata = pageMetadata({
  title: "제품 가이드 — TAVONEL",
  description: "TAVONEL이 오늘 제공하는 것을 단계별로 사용합니다. 공개 Compiled World와 근거·변경, 서명된 샘플, 키 없는 API 읽기, 개발자 파일, MCP 브리지를 다룹니다.",
  canonical: "/ko/guide",
  languages: { ko: "/ko/guide", en: "/guide", "x-default": "/guide" },
});

export default function Page() {
  return <GuidePage language="ko" />;
}
