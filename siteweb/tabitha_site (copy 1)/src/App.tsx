import { useCallback, useEffect, useState } from "react";
import MatrixRain from "./components/MatrixRain";
import CodePage from "./components/CodePage";
import Message from "./components/Message";
import PageTwo from "./components/PageTwo";
import PageThree from "./components/PageThree";

type Phase =
  | "code" // page 1: code entry
  | "fading" // page 1 content fades out after validation
  | "message1" // "Criminel c'est pas ça"
  | "message2" // "Belelou fallait pas trouver"
  | "page2" // galaxy + star heart
  | "page3"; // digital library

const CONTENT_FADE_MS = 1000;

export default function App() {
  const [phase, setPhase] = useState<Phase>("code");

  const handleValidate = useCallback(() => setPhase("fading"), []);

  // Once the content has faded out, show the first message.
  useEffect(() => {
    if (phase !== "fading") return;
    const timer = setTimeout(() => setPhase("message1"), CONTENT_FADE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const goToMessage2 = useCallback(() => setPhase("message2"), []);
  const goToPage2 = useCallback(() => setPhase("page2"), []);
  const goToPage3 = useCallback(() => setPhase("page3"), []);
  const backToPage2 = useCallback(() => setPhase("page2"), []);

  const showCode = phase === "code" || phase === "fading";
  // Keep the galaxy mounted under the library so going back is instant.
  const showGalaxy = phase === "page2" || phase === "page3";

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-black text-pink-400 select-none">
      {phase !== "page2" && phase !== "page3" && <MatrixRain />}

      {showCode && (
        <CodePage
          active={phase === "code"}
          fading={phase === "fading"}
          onValidate={handleValidate}
        />
      )}

      {phase === "message1" && (
        <Message key="message1" text="Criminel c'est pas ça" onDone={goToMessage2} />
      )}

      {phase === "message2" && (
        <Message key="message2" text="Belelou fallait pas trouver" onDone={goToPage2} />
      )}

      {showGalaxy && (
        <PageTwo onOpenLibrary={goToPage3} dimmed={phase === "page3"} />
      )}

      {phase === "page3" && <PageThree onBack={backToPage2} />}
    </main>
  );
}
