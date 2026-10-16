/** Visible Korean labels only. Submitted qualification values remain the validated catalog values. */
export type ContactLocale = "en" | "ko";

const KOREAN: Record<string, string> = {
  "Three fields are needed for a reply. They are marked Required.": "답변에 필요한 항목 세 개는 필수로 표시했습니다.",
  "Name": "이름",
  "Work email": "업무용 이메일",
  "Company or organization": "회사 또는 기관",
  "Inquiry type": "문의 유형",
  "Product and pricing": "제품 및 요금",
  "Product support": "제품 지원",
  "Security review": "보안 검토",
  "Privacy": "개인정보",
  "Partnership": "제휴",
  "Help us prepare a better reply": "상황을 알려주시면 더 구체적으로 답변할 수 있습니다",
  "Optional": "선택",
  "About the material": "자료에 관하여",
  "Estimated document volume": "예상 문서 수",
  "Not known yet": "아직 모름",
  "Under 100": "100개 미만",
  "100 to 1,000": "100~1,000개",
  "1,000 to 10,000": "1,000~10,000개",
  "More than 10,000": "10,000개 초과",
  "Source types": "자료 유형",
  "Choose every one that applies.": "해당하는 항목을 모두 선택하세요.",
  "Scanned PDFs": "스캔한 PDF",
  "Digital PDFs": "디지털 PDF",
  "Office documents": "오피스 문서",
  "Drawings or diagrams": "도면 또는 다이어그램",
  "Google Drive, SharePoint or Dropbox": "Google Drive, SharePoint 또는 Dropbox",
  "An existing wiki or database": "기존 위키 또는 데이터베이스",
  "What the knowledge is for": "지식의 사용 목적",
  "Not decided": "미정",
  "Grounded answers for a team": "팀이 근거를 확인할 수 있는 답변",
  "A knowledge source an agent reads": "AI 에이전트가 읽는 지식 원천",
  "A reviewed knowledge graph": "검토된 지식 그래프",
  "A portable export into our own stack": "자체 시스템으로 가져갈 수 있는 내보내기",
  "Timeline": "예상 일정",
  "Exploring": "검토 중",
  "Within a quarter": "한 분기 이내",
  "Within a month": "한 달 이내",
  "Already committed": "이미 일정 확정",
  "Deployment preference (one managed deployment is offered today)": "배포 방식 선호도 (현재는 관리형 배포 한 가지만 제공)",
  "Managed by TAVONEL": "TAVONEL 관리형",
  "Our own cloud account": "자사 클라우드 계정",
  "Air-gapped or on-premise": "망 분리 또는 자체 서버",
  "Data region preference (not all regions are offered today)": "데이터 지역 선호도 (모든 지역을 제공하지는 않음)",
  "Korea": "한국",
  "European Union": "유럽연합",
  "United Kingdom": "영국",
  "United States": "미국",
  "Elsewhere": "기타",
  "No answer": "응답하지 않음",
  "What are you trying to do?": "어떤 일을 해결하려고 하시나요?",
  "Required": "필수",
  "Do not attach or paste customer documents here.": "고객 문서를 첨부하거나 본문에 붙여 넣지 마세요.",
  "What the material is, who needs to answer from it, and anything the questions above did not cover.": "자료의 종류, 누가 이 자료를 활용할지, 위 항목에서 다루지 못한 내용을 알려주세요.",
  "Website": "웹사이트",
  "Sending...": "전송 중...",
  "Send inquiry": "문의 보내기",
  "We use this information to answer your inquiry.": "입력한 정보는 문의에 답변하는 데 사용합니다.",
  "Received. We will reply from an official TAVONEL address.": "문의가 접수됐습니다. TAVONEL 공식 이메일 주소에서 답변드립니다.",
  "We could not send your inquiry.": "문의를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.",
  "Check the required fields and their lengths, then send again.": "필수 항목과 입력 길이를 확인해 주세요.",
  "Your inquiry is larger than this form can send. Shorten the message or remove some optional answers, then send it again.": "문의 전체 크기가 이 양식으로 보낼 수 있는 한도를 넘었습니다. 문의 내용을 줄여 쓰거나 선택 항목의 답변 일부를 지운 뒤 다시 보내 주세요.",
  "Too many inquiries were sent. Please try again in 10 minutes.": "문의 전송이 잠시 제한됐습니다. 10분 후 다시 시도해 주세요.",
  "Your inquiry cannot be sent from this page, so sending it again will not help. Your answers are still in the form.": "이 화면에서는 문의를 보낼 수 없어 다시 보내도 해결되지 않습니다. 입력한 내용은 양식에 그대로 남아 있습니다.",
  "Email us instead at": "대신 다음 주소로 메일을 보내 주세요:",
  "We could not send your inquiry. Your answers are still in the form.": "문의를 보내지 못했습니다. 입력한 내용은 양식에 그대로 남아 있습니다.",
  "Send it again, or email us at": "다시 보내거나 다음 주소로 메일을 보내 주세요:",
};

/** The address a visitor can write to when the form itself cannot deliver. */
export const CONTACT_EMAIL = "hello@tavonel.com";

/** A failed send's public copy. Both parts are English keys, translated where they are rendered. */
export type ContactErrorCopy = {
  message: string;
  /** The lead-in to the fallback address, or null where no address is offered. */
  fallback: string | null;
  /**
    Whether sending again can succeed. False is terminal: the form keeps Send disabled and moves
    focus to the status, so the only action left on screen is the fixed address.
  */
  retry: boolean;
};

/**
  Public copy for a failed send, keyed by HTTP status (none for a network failure).

  Never the server's `error` string or the browser's exception text: those are written for
  logs, not for a visitor, and a network abort reads "Failed to fetch". Where `fallback` is set,
  the address follows it as a link to the bare address -- no answer from the form is ever
  written into the mailto URI.

  The recovery offered is the one a second attempt can reach. 400, 413 and 429 are fixed in the
  form or by waiting, so the copy says what to change and offers nothing else. 403 (origin
  refused) and 415 (not a JSON request) refuse the request rather than its answers, and an
  unchanged retry is refused the same way, so the copy says so and offers the address alone.
  Anything else -- a 5xx, an unexpected status, a network failure -- may pass on a second
  attempt, so both are offered.

  413 is the size of the whole request, not of the message: the message's 5,000-character cap
  says nothing about bytes, and a Hangul syllable is three of them in UTF-8. So the copy names
  both things a visitor can trim.
*/
export function contactErrorCopy(status?: number): ContactErrorCopy {
  if (status === 400) return { message: "Check the required fields and their lengths, then send again.", fallback: null, retry: true };
  if (status === 403 || status === 415) {
    return {
      message: "Your inquiry cannot be sent from this page, so sending it again will not help. Your answers are still in the form.",
      fallback: "Email us instead at",
      retry: false,
    };
  }
  if (status === 413) {
    return {
      message: "Your inquiry is larger than this form can send. Shorten the message or remove some optional answers, then send it again.",
      fallback: null,
      retry: true,
    };
  }
  if (status === 429) return { message: "Too many inquiries were sent. Please try again in 10 minutes.", fallback: null, retry: true };
  return { message: "We could not send your inquiry. Your answers are still in the form.", fallback: "Send it again, or email us at", retry: true };
}

export function contactText(value: string, locale: ContactLocale): string {
  return locale === "ko" ? KOREAN[value] ?? value : value;
}

export function hasKoreanContactText(value: string): boolean {
  return value in KOREAN;
}

/**
  The Korean failure text as the form renders it, the address included where one is offered.

  Derived from `contactErrorCopy` rather than kept as a table of its own: a second table is how
  this helper came to offer the address alone for 403 and 415 while the form still asked for a
  retry.
*/
export function koreanContactError(status?: number): string {
  const { message, fallback } = contactErrorCopy(status);
  const text = contactText(message, "ko");
  return fallback ? `${text} ${contactText(fallback, "ko")} ${CONTACT_EMAIL}` : text;
}
