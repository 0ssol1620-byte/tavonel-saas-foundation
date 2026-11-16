import tokens from "../tokens.module.css";

/** Every surface `tokens.module.css` declares. Each one carries its own colour and background. */
export const V34_SURFACES = [
  "paper", "light", "green", "cases", "routeFoot", "bridge", "final",
  "dark", "connect", "forest", "heroHome", "world", "nestedLight",
] as const;

export type V34Surface = (typeof V34_SURFACES)[number];

export const surfaceClass = (surface: V34Surface): string => tokens[surface] ?? "";
