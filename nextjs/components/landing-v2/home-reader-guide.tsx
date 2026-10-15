import styles from "./landing-hero.module.css";

// Adapt the accepted private concept's reading questions to the actual public sample.
// Its fictional policy, invented revisions, disconnected form and prototype consent never ship.
const COPY = {
  en: {
    title: "Before relying on an AI answer",
    support: "Ask these questions of any tool that turns documents into knowledge for AI, this one included.",
    checks: [
      ["Can I see the exact words?", "Check the passage an answer relies on, then read the surrounding page. A summary can cite its sources without repeating every word."],
      ["Which document, and which version?", "A passage from an earlier version can be quoted correctly and still be out of date. Check the source version as well as its wording."],
      ["Who chose this source?", "Ask who owns the source list and who can remove a document. A citation alone does not establish that a source belongs."],
      ["What happens when the source changes?", "Ask whether earlier records are flagged, updated or left as they were. Compare the versions before relying on an earlier record."],
    ],
    faqTitle: "About the sample on this page",
    faq: [
      ["Has this demonstration been verified?", "No. The workbench shows existing extracted text from the published sample, with its source and location. Processing has not been run for this prepared demonstration; interpretation and verification are separate steps. The record under What you receive is picked by a fixed rule, not by how it reads: the first claim in the sample, in document order, that is one complete sentence with no heading run into it, has at least twelve words, and is not boilerplate (forward-looking or safe-harbour language, or a fragment opening “For example,” or “Such as”)."],
      ["Is the page image the original filing?", "The image is a reference render. Open full filing (SEC) links to the original HTML filing; Open full page opens the committed page image. Source details keeps the version and publication basis alongside the passage."],
      ["Can I use my own documents?", "Own-source intake is by arrangement. Use the access action on this page to discuss your documents. The public sample does not upload or process your files."],
    ],
    back: "Return to the source and passage",
  },
  ko: {
    title: "AI 답변을 믿기 전에",
    support: "문서를 AI용 지식으로 바꾸는 도구라면, 이 도구를 포함해 다음 질문을 해 보세요.",
    checks: [
      ["정확한 원문을 볼 수 있나요?", "답변의 근거가 된 구절을 확인하고 주변 페이지도 읽어 보세요. 요약은 모든 문장을 반복하지 않고도 출처를 인용할 수 있습니다."],
      ["어느 문서의 어느 버전인가요?", "이전 버전의 구절을 정확하게 인용했어도 지금은 맞지 않을 수 있습니다. 문구와 함께 출처 버전도 확인하세요."],
      ["누가 이 출처를 선택했나요?", "누가 출처 목록을 관리하고 문서를 제외할 수 있는지 물어보세요. 인용이 있다는 사실만으로 적절한 출처라는 보장은 없습니다."],
      ["출처가 바뀌면 어떻게 되나요?", "이전 기록에 변경을 표시하는지, 갱신하는지, 그대로 두는지 물어보세요. 이전 기록을 사용하기 전에 버전을 비교하세요."],
    ],
    faqTitle: "이 페이지의 샘플에 대해",
    faq: [
      ["이 시연은 검증을 거쳤나요?", "아닙니다. 작업대는 공개 샘플에서 기존에 추출한 텍스트를 출처와 위치와 함께 보여 줍니다. 이 준비된 시연에서 실제 처리는 실행하지 않았으며, 해석과 검증은 별도의 단계입니다. 받게 되는 것 아래의 기록은 읽기 좋은지가 아니라 정해진 규칙으로 고릅니다. 샘플에서 문서 순서상 처음 나오는 진술 중 제목이 본문에 붙지 않은 완결된 한 문장이고, 열두 단어 이상이며, 상투 문구(미래 예측·면책 조항 문구, 또는 “For example,”·“Such as”로 시작하는 조각)가 아닌 것입니다."],
      ["페이지 이미지가 원본 공시인가요?", "이미지는 참조 렌더입니다. 전체 공시 열기 (SEC)는 원본 HTML 공시로 연결되고, 원본 페이지 열기는 저장된 페이지 이미지를 엽니다. 출처 상세에는 구절의 버전과 게시 근거가 있습니다."],
      ["내 문서를 사용할 수 있나요?", "자체 자료 도입은 별도 협의가 필요합니다. 이 페이지의 이용 안내를 통해 문서에 관해 상담하세요. 공개 샘플은 사용자의 파일을 업로드하거나 처리하지 않습니다."],
    ],
    back: "출처와 구절로 돌아가기",
  },
};

export default function HomeReaderGuide({ korean = false, faqOnly = false }: { korean?: boolean; faqOnly?: boolean }) {
  const copy = COPY[korean ? "ko" : "en"];
  return (
    <div className={styles.readerGuide} role="region" aria-labelledby={faqOnly ? "home-faq-title" : "home-reader-title"} data-home-reader-guide>
      <div className={`lv2-wrap ${styles.readerLayout}`}>
        {!faqOnly ? <><div className={styles.readerHead}>
          <h2 id="home-reader-title">{copy.title}</h2>
          <p>{copy.support}</p>
          <a href="#s2" className={styles.diffLink}>{copy.back}<span aria-hidden="true">↑</span></a>
        </div>
        <ul className={styles.readerChecks}>
          {copy.checks.map(([title, body]) => <li key={title}><h3>{title}</h3><p>{body}</p></li>)}
        </ul></> : null}
        <div className={styles.readerFaq}>
          <h2 id="home-faq-title">{copy.faqTitle}</h2>
          <div>
            {copy.faq.map(([question, answer]) => (
              <details key={question}>
                <summary>{question}</summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
