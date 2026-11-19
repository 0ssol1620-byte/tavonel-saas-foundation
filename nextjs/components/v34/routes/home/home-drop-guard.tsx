"use client";

import { useEffect } from "react";
import s from "./home.module.css";

/*
  A file dropped anywhere on Home would open in the tab and leave the site. This cancels dragover and drop
  on the document, reads nothing and keeps nothing (the legacy hero did the same: PR #177 review round 2,
  nit 1). The hero's primary action says it is where a dropped file goes, and a drop moves focus to it; the
  action then opens the document entry as it always did, by click or keyboard. It renders nothing.
*/
export default function HomeDropGuard() {
  useEffect(() => {
    const entry = () => document.querySelector<HTMLElement>('[data-analytics="hero-primary"]');
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
    const mark = (on: boolean) => entry()?.classList.toggle(s.dragging!, on);
    const onDragOver = (event: DragEvent) => { if (hasFiles(event)) { event.preventDefault(); mark(true); } };
    const onDragLeave = (event: DragEvent) => { if (!event.relatedTarget) mark(false); };
    const onDrop = (event: DragEvent) => {
      mark(false);
      if (!hasFiles(event)) return;
      event.preventDefault();
      const target = entry();
      target?.focus();
      target?.scrollIntoView({ block: "center" });
    };
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("drop", onDrop);
      mark(false);
    };
  }, []);
  return null;
}
