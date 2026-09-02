import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: true },
  alternates: { canonical: "/" },
};

export default function FilmLayout({ children }: { children: React.ReactNode }) {
  return children;
}
