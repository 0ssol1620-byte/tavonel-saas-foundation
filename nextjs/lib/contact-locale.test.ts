import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ContactForm from "@/components/contact-form";
import { QUALIFICATION } from "./contact-qualification";
import { contactText, hasKoreanContactText, koreanContactError } from "./contact-locale";

describe("Korean contact path", () => {
  it("translates every visible qualification label and option while preserving submitted values", () => {
    for (const field of QUALIFICATION) {
      expect(hasKoreanContactText(field.label), field.label).toBe(true);
      if (field.hint) expect(hasKoreanContactText(field.hint), field.hint).toBe(true);
      for (const option of field.options) {
        expect(hasKoreanContactText(option), option).toBe(true);
      }
    }
    const html = renderToStaticMarkup(createElement(ContactForm, { locale: "ko" }));
    expect(html).toContain("문의 유형");
    expect(html).toContain('value="Under 100"');
    expect(html).toContain("100개 미만");
    expect(html).toContain("개인정보 처리방침 (영문)");
    expect(html).toContain('href="/privacy"');
    expect(html).not.toContain("Estimated document volume");
    expect(contactText("Under 100", "en")).toBe("Under 100");
  });

  it("gives an actionable Korean error for invalid, limited, and unavailable submissions", () => {
    expect(koreanContactError(400)).toContain("필수 항목");
    expect(koreanContactError(413)).toContain("내용을 줄여");
    expect(koreanContactError(429)).toContain("10분 후");
    expect(koreanContactError(403)).toContain("hello@tavonel.com");
    expect(koreanContactError(415)).toContain("hello@tavonel.com");
    expect(koreanContactError(503)).toContain("hello@tavonel.com");
    expect(koreanContactError()).toContain("hello@tavonel.com");
  });
});
