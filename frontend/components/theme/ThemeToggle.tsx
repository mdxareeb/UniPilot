"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";

const STORAGE_KEY = "unipilot-theme";

type Theme = "dark" | "light";

/** The live theme is the class the boot script set on `<html>` — read from
    there, not from state, so every toggle instance agrees with what is on
    screen and with what a second tab might have changed. */
function currentTheme(): Theme {
  return document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
}

/**
 * The sun/moon switch. Dark is the default on first visit: the boot script in
 * `app/layout.tsx` applies it before first paint, so this button only ever
 * flips between two already-initialized states and persists the choice.
 *
 * The icon shows the theme that is active; the label names what pressing does.
 * Until hydration the server and the first client render both show the dark
 * default — the same frame the boot script guarantees is on screen — and the
 * effect syncs to the real class before the user can reach the button.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  /* The server and the first client render both show the dark default, which
     is the frame the boot script guarantees is on screen; the read of the
     real class is deferred to a frame so state is set from a callback, not
     synchronously in the effect body. */
  useEffect(() => {
    const frame = requestAnimationFrame(() => setTheme(currentTheme()));
    return () => cancelAnimationFrame(frame);
  }, []);

  const toggle = () => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* A blocked localStorage (Safari private mode, hardening extensions)
         leaves the theme session-local rather than breaking the toggle. */
    }
    setTheme(next);
  };

  return (
    <IconButton
      variant="outline"
      size="sm"
      aria-label={
        theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
      }
      className="rounded-pill"
      onClick={toggle}
    >
      {theme === "dark" ? (
        <Moon aria-hidden="true" className="size-4" />
      ) : (
        <Sun aria-hidden="true" className="size-4" />
      )}
    </IconButton>
  );
}
