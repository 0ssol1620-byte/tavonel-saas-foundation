import type { ReactNode } from "react";
import s from "./text.module.css";

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className={s.eyebrow}>{children}</p>;
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className={s.lead}>{children}</p>;
}
