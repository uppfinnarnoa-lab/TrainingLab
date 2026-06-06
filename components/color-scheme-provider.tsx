"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type ColorScheme = "forest" | "ocean" | "ember" | "mono" | "slate" | "sky";
export const COLOR_SCHEMES: ColorScheme[] = ["forest", "ocean", "ember", "mono", "slate", "sky"];
const KEY = "traininglab_scheme";

const Ctx = createContext<{ scheme: ColorScheme; setScheme: (s: ColorScheme) => void }>({
  scheme: "forest",
  setScheme: () => {},
});

export function ColorSchemeProvider({ children }: { children: React.ReactNode }) {
  const [scheme, setSchemeState] = useState<ColorScheme>("forest");

  useEffect(() => {
    const saved = localStorage.getItem(KEY) as ColorScheme | null;
    if (saved && COLOR_SCHEMES.includes(saved)) {
      applyScheme(saved);
      setSchemeState(saved);
    }
  }, []);

  function applyScheme(s: ColorScheme) {
    const html = document.documentElement;
    html.classList.remove(...COLOR_SCHEMES.map(x => `scheme-${x}`));
    if (s !== "forest") html.classList.add(`scheme-${s}`);
  }

  function setScheme(s: ColorScheme) {
    applyScheme(s);
    localStorage.setItem(KEY, s);
    setSchemeState(s);
  }

  return <Ctx.Provider value={{ scheme, setScheme }}>{children}</Ctx.Provider>;
}

export const useColorScheme = () => useContext(Ctx);
