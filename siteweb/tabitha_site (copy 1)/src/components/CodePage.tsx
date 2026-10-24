import { useCallback, useEffect, useState } from "react";
import { CODE_LENGTH, isSecretCode } from "../utils/secret";

interface CodePageProps {
  /** Input is accepted only while the page is active. */
  active: boolean;
  /** Content is faded out (after validation). */
  fading: boolean;
  onValidate: () => void;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export default function CodePage({ active, fading, onValidate }: CodePageProps) {
  const [digits, setDigits] = useState("");
  // Holds the digit string that was verified as correct (null otherwise).
  const [validDigits, setValidDigits] = useState<string | null>(null);

  const canValidate = active && digits.length === CODE_LENGTH && validDigits === digits;

  const press = useCallback((d: string) => {
    setDigits((prev) => (prev.length < CODE_LENGTH ? prev + d : prev));
  }, []);

  const erase = useCallback(() => {
    setDigits((prev) => prev.slice(0, -1));
  }, []);

  // Verify the hash whenever a full 8-digit code has been entered.
  useEffect(() => {
    if (digits.length !== CODE_LENGTH) return;
    let cancelled = false;
    isSecretCode(digits).then((ok) => {
      if (!cancelled) setValidDigits(ok ? digits : null);
    });
    return () => {
      cancelled = true;
    };
  }, [digits]);

  // Physical keyboard support.
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        press(e.key);
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        erase();
      } else if (e.key === "Enter" && canValidate) {
        e.preventDefault();
        onValidate();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, canValidate, onValidate, press, erase]);

  // Display: 4 slots, a dash, 4 slots. Empty slots show "_".
  const slots = Array.from({ length: CODE_LENGTH }, (_, i) => digits[i] ?? "_");
  const display = `${slots.slice(0, 4).join("")}-${slots.slice(4).join("")}`;

  return (
    <section
      className={`relative z-10 flex h-full w-full items-center justify-center overflow-y-auto transition-opacity duration-1000 ease-in-out ${
        fading ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <div className="flex min-h-full w-full flex-col items-center justify-center gap-8 px-5 py-10 sm:gap-10">
        <h1 className="glow-text max-w-3xl text-center text-3xl leading-tight font-bold sm:text-5xl md:text-6xl">
          Entrer le bon code pour déverrouiller la suite
        </h1>

        <div className="glow-box rounded-2xl border border-pink-500/50 bg-black/60 px-6 py-4 sm:px-10 sm:py-6">
          <span className="glow-text font-mono text-4xl tracking-[0.12em] whitespace-pre sm:text-6xl">
            {display}
          </span>
        </div>

        <div className="grid w-full max-w-xs grid-cols-3 gap-3 sm:max-w-sm sm:gap-4">
          {KEYS.map((k) => (
            <button
              key={k}
              type="button"
              disabled={!active}
              onClick={() => press(k)}
              className="key-btn"
            >
              {k}
            </button>
          ))}
          <div aria-hidden="true" />
          <button
            type="button"
            disabled={!active}
            onClick={() => press("0")}
            className="key-btn"
          >
            0
          </button>
          <button
            type="button"
            disabled={!active}
            onClick={erase}
            aria-label="Effacer"
            className="key-btn"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-7 w-7 sm:h-8 sm:w-8"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
              <path d="M18 9l-6 6" />
              <path d="M12 9l6 6" />
            </svg>
          </button>
        </div>

        <div className="flex h-16 items-center justify-center">
          {canValidate && (
            <button
              type="button"
              onClick={onValidate}
              className="animate-fade-zoom glow-button rounded-full border border-pink-400 bg-pink-500/20 px-12 py-3 text-xl font-semibold tracking-widest text-pink-100 transition hover:bg-pink-500/40 active:scale-95"
            >
              Valider
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
