"use client";

import { useEffect } from "react";

type VirtualKeyboardNavigator = Navigator & {
  virtualKeyboard?: {
    overlaysContent: boolean;
  };
};

export function ViewportKeyboardSync() {
  useEffect(() => {
    const root = document.documentElement;
    const visualViewport = window.visualViewport;

    const syncViewportVariables = () => {
      const viewportHeight = visualViewport?.height ?? window.innerHeight;
      const keyboardInset = visualViewport
        ? Math.max(
            0,
            window.innerHeight - visualViewport.height - visualViewport.offsetTop
          )
        : 0;

      root.style.setProperty("--visual-viewport-height", `${viewportHeight}px`);
      root.style.setProperty("--keyboard-inset-bottom", `${keyboardInset}px`);
    };

    try {
      const virtualKeyboard = (navigator as VirtualKeyboardNavigator)
        .virtualKeyboard;
      if (virtualKeyboard && "overlaysContent" in virtualKeyboard) {
        virtualKeyboard.overlaysContent = false;
      }
    } catch {
      // Some Chromium builds expose the API but do not allow writes yet.
    }

    syncViewportVariables();
    visualViewport?.addEventListener("resize", syncViewportVariables);
    visualViewport?.addEventListener("scroll", syncViewportVariables);
    window.addEventListener("resize", syncViewportVariables);

    return () => {
      visualViewport?.removeEventListener("resize", syncViewportVariables);
      visualViewport?.removeEventListener("scroll", syncViewportVariables);
      window.removeEventListener("resize", syncViewportVariables);
      root.style.removeProperty("--visual-viewport-height");
      root.style.removeProperty("--keyboard-inset-bottom");
    };
  }, []);

  return null;
}
