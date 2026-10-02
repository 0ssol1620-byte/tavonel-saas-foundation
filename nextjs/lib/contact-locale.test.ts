import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ContactForm from "@/components/contact-form";
import { QUALIFICATION } from "./contact-qualification";
import { CONTACT_EMAIL, contactErrorCopy, contactText, hasKoreanContactText, koreanContactError } from "./contact-locale";

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

describe("contact failure recovery", () => {
  it("offers only the fixed address, not a retry, when the request itself is refused (403, 415)", () => {
    for (const status of [403, 415]) {
      expect(contactErrorCopy(status), String(status)).toEqual({
        message: "Your inquiry cannot be sent from this page, so sending it again will not help. Your answers are still in the form.",
        fallback: "Email us instead at",
        retry: false,
      });
      expect(koreanContactError(status), String(status)).toBe(
        "이 화면에서는 문의를 보낼 수 없어 다시 보내도 해결되지 않습니다. 입력한 내용은 양식에 그대로 남아 있습니다. 대신 다음 주소로 메일을 보내 주세요: hello@tavonel.com",
      );
      expect(koreanContactError(status), String(status)).not.toContain("다시 보내거나");
    }
    // A failure a second attempt may clear still offers both.
    for (const status of [undefined, 500, 502, 503]) {
      expect(contactErrorCopy(status).fallback, String(status)).toBe("Send it again, or email us at");
      expect(koreanContactError(status), String(status)).toContain(`다시 보내거나 다음 주소로 메일을 보내 주세요: ${CONTACT_EMAIL}`);
    }
  });

  it("describes a 413 as the whole inquiry being too large and names what to trim before sending again", () => {
    expect(contactErrorCopy(413)).toEqual({
      message: "Your inquiry is larger than this form can send. Shorten the message or remove some optional answers, then send it again.",
      fallback: null,
      retry: true,
    });
    expect(koreanContactError(413)).toBe(
      "문의 전체 크기가 이 양식으로 보낼 수 있는 한도를 넘었습니다. 문의 내용을 줄여 쓰거나 선택 항목의 답변 일부를 지운 뒤 다시 보내 주세요.",
    );
    expect(koreanContactError(413)).not.toContain(CONTACT_EMAIL);
  });

  it("marks only a refused request (403, 415) as terminal; every other failure keeps the resend", () => {
    // Terminal: the form keeps Send disabled and focuses the status with the fixed address.
    for (const status of [403, 415]) expect(contactErrorCopy(status).retry, String(status)).toBe(false);
    // Retryable: Send is re-enabled and focused (413 after trimming, 429 after waiting, 5xx/network as is).
    for (const status of [undefined, 400, 413, 429, 500, 502, 503]) expect(contactErrorCopy(status).retry, String(status)).toBe(true);
  });

  it("translates every failure message and recovery lead-in into Korean", () => {
    for (const status of [undefined, 400, 403, 413, 415, 429, 500, 502, 503]) {
      const { message, fallback } = contactErrorCopy(status);
      for (const english of fallback ? [message, fallback] : [message]) {
        expect(hasKoreanContactText(english), english).toBe(true);
        expect(contactText(english, "ko"), english).toMatch(/[가-힣]/);
      }
    }
  });
});
