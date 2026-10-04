"use client";

import { useState } from "react";
import CompileStagePlayer from "@/components/compile-stage-player";
import type { CompileStage } from "@/lib/compile-stages";

export default function HeroFilmDisclosure({
  korean,
  stages,
}: {
  korean: boolean;
  stages: CompileStage[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <details className="lv2-film-story" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{korean ? "예시 제품 흐름 영상 보기" : "Watch the illustrative product walkthrough"}</summary>
      {open ? (
        <div className="lv2-film">
          <CompileStagePlayer stages={stages} preferVideo korean={korean} />
          <p className="fine">{korean ? "영상은 제품 인터페이스를 설명하기 위한 예시입니다. 표시된 자료와 응답은 고객 결과가 아닙니다." : "Illustrative product walkthrough. The displayed documents and answers are examples, not customer results."}</p>
        </div>
      ) : null}
    </details>
  );
}
