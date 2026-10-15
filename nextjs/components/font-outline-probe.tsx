"use client";
import { useEffect } from "react";

/*
  Sets html[data-static-wght="1"] only where the engine does not draw the wght axis of Wanted Sans
  Variable (measured: Playwright WebKit on Windows). It draws one glyph at 400 and at 1000 and
  compares the ink; where the axis draws, 1000 has far more ink and nothing is set.
  The CSS that reads the flag is the WEIGHT-HOOK block in source-first-home.module.css.
*/
export default function FontOutlineProbe() {
  useEffect(() => {
    const family = '"Wanted Sans Variable"';
    let live = true;
    Promise.all([document.fonts.load(`400 48px ${family}`), document.fonts.load(`1000 48px ${family}`)]).then(([a, b]) => {
      if (!live || !a.length || !b.length) return; // face absent: the fallback has real bold cuts
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 64;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      const ink = (weight: number) => {
        context.clearRect(0, 0, 64, 64);
        context.font = `${weight} 48px ${family}`;
        context.fillText("l", 24, 52);
        const data = context.getImageData(0, 0, 64, 64).data;
        let sum = 0;
        for (let i = 3; i < data.length; i += 4) sum += data[i]!;
        return sum;
      };
      if (ink(1000) < ink(400) * 1.3) document.documentElement.dataset.staticWght = "1";
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  return null;
}
