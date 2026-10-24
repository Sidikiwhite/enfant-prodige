import { useState, useMemo } from "react";
import { LIBRARY_ITEMS } from "../data/library";

interface PageThreeProps {
  onBack: () => void;
}

export default function PageThree({ onBack }: PageThreeProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = LIBRARY_ITEMS.find((it) => it.id === selectedId) ?? null;

  const shuffledItems = useMemo(() => {
    return [...LIBRARY_ITEMS].sort(() => Math.random() - 0.5);
  }, []);

  return (
    <section className="absolute inset-0 z-40 flex flex-col bg-gradient-to-b from-black via-[#140009] to-black">
      {/* Header */}
      <header className="flex shrink-0 flex-col items-center gap-1 px-6 pt-8 pb-4 text-center sm:pt-10">
        <h1 className="glow-text animate-rise-in text-3xl font-bold sm:text-5xl">
          Pour ma Reine
        </h1>
        <p className="text-xs tracking-[0.3em] text-pink-200/70 uppercase sm:text-sm">
          Bibliothèque de souvenirs
        </p>
      </header>

      {/* Grid of medium icons */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-8">
        <div className="mx-auto grid max-w-3xl grid-cols-3 gap-3 sm:grid-cols-4 sm:gap-4">
          {shuffledItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedId(item.id)}
              aria-label={`Ouvrir ${item.title}`}
              className="group relative aspect-square overflow-hidden rounded-2xl border border-pink-500/50 bg-black/60 transition active:scale-95"
              style={{
                boxShadow: "0 0 14px rgba(255,20,147,0.35)",
              }}
            >
              {item.type === "video" ? (
                <video
                  src={item.thumbnail}
                  muted
                  playsInline
                  autoPlay
                  loop
                  className="h-full w-full object-cover opacity-60 transition duration-300 group-hover:scale-105 group-hover:opacity-100"
                />
              ) : (
                <img
                  src={item.thumbnail}
                  alt={item.title}
                  loading="lazy"
                  draggable={false}
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                />
              )}
              {item.type === "video" && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full border border-pink-200/80 bg-pink-500/40 backdrop-blur-sm sm:h-12 sm:w-12">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5 fill-white sm:h-6 sm:w-6"
                      aria-hidden="true"
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Bottom return bar */}
      <footer className="flex shrink-0 items-center justify-center px-6 pt-2 pb-6 sm:pb-8">
        <button
          type="button"
          onClick={onBack}
          className="glow-button flex items-center gap-2 rounded-full border border-pink-400/70 bg-pink-500/20 px-10 py-3 text-base font-semibold tracking-widest text-pink-100 uppercase transition hover:bg-pink-500/40 active:scale-95 sm:text-lg"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
          Retour
        </button>
      </footer>

      {/* Fullscreen viewer */}
      {selected && (
        <div
          className="animate-fade-zoom absolute inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-black/95 p-6"
          onClick={() => setSelectedId(null)}
        >
          {selected.type === "photo" ? (
            <img
              src={selected.src}
              alt={selected.title}
              className="max-h-[75vh] max-w-full rounded-2xl border border-pink-400/60 object-contain shadow-[0_0_40px_rgba(255,20,147,0.5)]"
            />
          ) : (
            <video
              src={selected.src}
              controls
              autoPlay
              muted={false}
              playsInline
              preload="metadata"
              className="max-h-[75vh] max-w-full rounded-2xl border border-pink-400/60 bg-black object-contain shadow-[0_0_40px_rgba(255,20,147,0.5)]"
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <p className="glow-text text-xl font-semibold tracking-widest sm:text-2xl">
            {selected.title}
          </p>
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="glow-button rounded-full border border-pink-400/70 bg-pink-500/20 px-10 py-2 text-sm font-semibold tracking-widest text-pink-100 uppercase transition hover:bg-pink-500/40 active:scale-95 sm:text-base"
          >
            Fermer
          </button>
        </div>
      )}
    </section>
  );
}
