import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GUIDE_UI,
  GUIDE_VIDEO_VARIANTS,
  guideVideoFiles,
  type GuideLanguage,
  type GuideMediaBlock,
  type GuideVideo,
} from "@/lib/guide-content";
import styles from "./guide.module.css";

/*
  A guide recording (EN-1's media block), in a module of its own so a page that shows one --
  /guide, /ko/guide, /docs/quickstart, /docs/mcp, /api -- imports the player and nothing else of
  the guide page. A server component: no client script, native `<video>`.
*/

const GUIDE_PUBLIC = join(process.cwd(), "public", "guide");

/*
  A recording renders only when every file of both takes is in `public/guide/` (the video lane
  delivers them; EN-1 references them by name). Until then the block renders nothing rather than
  a player whose poster and source 404. Half a delivery is not a state this page shows:
  `lib/guide-content.test.ts` fails when some of a recording's files are present and some are not.
*/
export function guideVideoReady(video: GuideVideo, root: string = GUIDE_PUBLIC): boolean {
  return GUIDE_VIDEO_VARIANTS.every((variant) =>
    Object.values(guideVideoFiles(video, variant)).every((file) => existsSync(join(root, file))),
  );
}

/**
 * The cue text of a WebVTT file, in order: the transcript under each player.
 *
 * Read from the caption file itself rather than copied into the guide, so the text beside the
 * video and the captions on it are one source. A cue is the lines after its timing line; the
 * header, NOTE and STYLE blocks carry no timing line and are skipped.
 */
export function vttCueText(vtt: string): string[] {
  return vtt
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.split("\n"))
    .map((lines) => {
      const timing = lines.findIndex((line) => line.includes("-->"));
      return timing === -1 ? "" : lines.slice(timing + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    })
    .filter((text) => text !== "");
}

/*
  Two takes, one shown. The phone take exists because text inside video pixels cannot be enlarged
  by CSS (UX-PLAN c2), and the two takes' captions are timed to their own recordings, so a single
  `<video>` with a media-selected `<source>` would run the wrong cue times on one of them.

  The poster is the `poster` attribute. A CSS background on the element was tried first, so the
  hidden take's poster would not be fetched, and it does not paint: Chrome draws a `<video>` with
  no poster and no frame as a black box over its own background (EN-1 QA, chrome-variants.png).
  The price is that both takes' posters are fetched, the hidden one included.

  No `autoplay`, no `loop`, `preload="none"`: nothing moves or downloads until the reader presses
  play, which is also the whole of the reduced-motion rule here -- there is no motion to reduce.
*/
export function GuideMedia({ block, language, root = GUIDE_PUBLIC }: { block: GuideMediaBlock; language: GuideLanguage; root?: string }) {
  if (!guideVideoReady(block.video, root)) return null;
  const ui = GUIDE_UI[language];
  const titleId = `${block.video}-title`;
  const transcript = vttCueText(readFileSync(join(root, guideVideoFiles(block.video, "desktop")[language]), "utf8"));
  return (
    <figure className={styles.media} data-guide-video={block.video}>
      {GUIDE_VIDEO_VARIANTS.map((variant) => {
        const files = guideVideoFiles(block.video, variant);
        return (
          <video
            key={variant}
            className={styles[variant]}
            controls
            preload="none"
            playsInline
            aria-labelledby={titleId}
            poster={`/guide/${files.poster}`}
          >
            <source src={`/guide/${files.mp4}`} type="video/mp4" />
            <track kind="captions" src={`/guide/${files.en}`} srcLang="en" label="English" default={language === "en"} />
            <track kind="captions" src={`/guide/${files.ko}`} srcLang="ko" label="한국어" default={language === "ko"} />
          </video>
        );
      })}
      <figcaption id={titleId}>{block.title}</figcaption>
      {transcript.length > 0 ? (
        <details className={styles.transcript}>
          <summary>{ui.transcript}</summary>
          <ol>{transcript.map((line, index) => <li key={index}>{line}</li>)}</ol>
        </details>
      ) : null}
    </figure>
  );
}
