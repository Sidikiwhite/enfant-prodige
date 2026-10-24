import { useEffect, useRef, useState } from "react";

const FADE_MS = 700;
const HOLD_MS = 5000; // fully visible for 5 seconds

interface MessageProps {
  text: string;
  /** Called once the message has faded out. */
  onDone: () => void;
}

export default function Message({ text, onDone }: MessageProps) {
  const [visible, setVisible] = useState(false);
  const doneRef = useRef(onDone);

  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const showTimer = setTimeout(() => setVisible(true), 50);
    const hideTimer = setTimeout(() => setVisible(false), 50 + FADE_MS + HOLD_MS);
    const doneTimer = setTimeout(
      () => doneRef.current(),
      50 + FADE_MS + HOLD_MS + FADE_MS
    );
    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      clearTimeout(doneTimer);
    };
  }, []);

  return (
    <div
      role="status"
      className={`fixed inset-0 z-20 flex items-center justify-center bg-black/70 p-6 transition-opacity ease-in-out ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <p className="glow-text animate-fade-zoom max-w-4xl text-center text-3xl leading-snug font-bold sm:text-5xl md:text-6xl">
        {text}
      </p>
    </div>
  );
}
