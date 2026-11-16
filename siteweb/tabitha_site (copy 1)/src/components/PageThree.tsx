import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LIBRARY_ITEMS, type LibraryItem } from "../data/library";

interface PageThreeProps {
  onBack: () => void;
}

/** Octets amorcés pour chaque vidéo proche de l'écran (≈2 s de lecture). */
const PRIME_BYTES = 128 * 1024;
/** Nombre d'amorçages simultanés. */
const PRIME_CONCURRENCY = 3;
/** Taille maximale de la file d'amorçage. */
const PRIME_QUEUE_MAX = 8;

type ConnectionInfo = { saveData?: boolean; effectiveType?: string };

/**
 * On n'amorce le réseau que si la connexion le supporte : sur 3G ou en mode
 * économie de données, la vignette suffit et on évite de consommer du forfait.
 */
function networkAllowsPriming() {
  const connection = (navigator as Navigator & { connection?: ConnectionInfo }).connection;
  if (!connection) return true;
  if (connection.saveData) return false;
  const type = connection.effectiveType;
  return !(type === "slow-2g" || type === "2g" || type === "3g");
}

/**
 * Lecteur vidéo. La vignette est affichée **dans le flux** et sert de fond :
 * l'écran ne montre donc jamais de cadre noir, même quand la vidéo n'a pas
 * encore téléchargé un seul octet. La vidéo n'apparaît qu'à la première frame
 * réellement décodée (`onPlaying`), par un fondu.
 */
function VideoStage({ item }: { item: LibraryItem }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [showSpinner, setShowSpinner] = useState(false);

  // Un spinner qui apparaît immédiatement clignote sur les réseaux rapides.
  useEffect(() => {
    const timer = setTimeout(() => setShowSpinner(true), 400);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // La prop React `muted` n'est pas toujours appliquée : iOS refuse alors
    // l'autoplay. On force la propriété avant de lancer la lecture.
    video.muted = true;
    const attempt = video.play();
    if (attempt) attempt.catch(() => undefined);
  }, [item.src]);

  const unmute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    video.volume = 1;
    setMuted(false);
  }, []);

  return (
    <div
      className="relative flex max-w-full items-center justify-center"
      onClick={(event) => event.stopPropagation()}
    >
      {/* Sert à la fois de fond pendant le chargement et de poster : c'est la
          même image que la vidéo, donc la transition est invisible. */}
      <img
        src={item.thumbnail}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="block max-h-[75vh] w-auto max-w-full rounded-2xl border border-pink-400/60 object-contain shadow-[0_0_40px_rgba(255,20,147,0.5)]"
      />

      <video
        ref={videoRef}
        src={item.src}
        muted
        autoPlay
        playsInline
        preload="metadata"
        controls
        onPlaying={() => setPlaying(true)}
        onError={() => {
          setPlaying(true);
          setShowSpinner(false);
        }}
        onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
        className={`absolute inset-0 h-full w-full rounded-2xl object-contain transition-opacity duration-300 ${
          playing ? "opacity-100" : "opacity-0"
        }`}
      />

      {!playing && showSpinner && (
        <span className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-pink-300/30 border-t-pink-300" />
        </span>
      )}

      {playing && muted && (
        <button
          type="button"
          onClick={unmute}
          className="glow-button absolute inset-x-0 top-4 mx-auto w-fit rounded-full border border-pink-300/70 bg-black/70 px-4 py-2 text-[11px] font-semibold tracking-widest text-pink-100 uppercase backdrop-blur-sm"
        >
          Son coupé · toucher
        </button>
      )}
    </div>
  );
}

export default function PageThree({ onBack }: PageThreeProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = LIBRARY_ITEMS.find((it) => it.id === selectedId) ?? null;

  const shuffledItems = useMemo(() => {
    return [...LIBRARY_ITEMS].sort(() => Math.random() - 0.5);
  }, []);

  // ---------------------------------------------------------------------
  // Amorçage réseau. On ne télécharge jamais une vidéo entière depuis la
  // grille : seulement les 128 premiers Ko de celles qui approchent de
  // l'écran, pour que la lecture démarre sans attente au clic.
  // ---------------------------------------------------------------------
  const scrollRef = useRef<HTMLDivElement>(null);
  const primedRef = useRef(new Set<string>());
  const queueRef = useRef<LibraryItem[]>([]);
  const inFlightRef = useRef(0);
  const pumpingRef = useRef(false);
  const allowedRef = useRef<boolean | null>(null);

  const pump = useCallback(() => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;

    const next = () => {
      while (inFlightRef.current < PRIME_CONCURRENCY && queueRef.current.length > 0) {
        const item = queueRef.current.shift()!;
        inFlightRef.current += 1;

        const done = () => {
          inFlightRef.current -= 1;
          next();
        };

        fetch(item.src, {
          headers: { Range: `bytes=0-${PRIME_BYTES - 1}` },
          priority: "low",
        })
          .then(async (response) => {
            if (response.status === 206) {
              // 128 Ko utiles : ils restent dans le cache HTTP et dans celui
              // du service worker, donc la lecture enchaîne sans coupure.
              await response.arrayBuffer();
            } else {
              // Serveur sans support des plages : on coupe pour ne pas
              // télécharger plusieurs Mo sans le vouloir.
              await response.body?.cancel();
            }
          })
          .then(done, done);
      }

      if (inFlightRef.current === 0 && queueRef.current.length === 0) {
        pumpingRef.current = false;
      }
    };

    next();
  }, []);

  const primeVideo = useCallback(
    (item: LibraryItem) => {
      if (item.type !== "video") return;
      if (allowedRef.current === null) allowedRef.current = networkAllowsPriming();
      if (!allowedRef.current) return;
      if (primedRef.current.has(item.src)) return;
      if (queueRef.current.length >= PRIME_QUEUE_MAX) return;

      primedRef.current.add(item.src);
      queueRef.current.push(item);
      pump();
    },
    [pump],
  );

  // Observateur de visibilité : amorce les vidéos qui approchent de l'écran.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;

    if (allowedRef.current === null) allowedRef.current = networkAllowsPriming();
    if (!allowedRef.current) return;

    const byId = new Map(LIBRARY_ITEMS.map((item) => [item.id, item]));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          const id = (entry.target as HTMLElement).dataset.libId;
          const item = id ? byId.get(id) : undefined;
          if (item) primeVideo(item);
        }
      },
      { root, rootMargin: "300px 0px" },
    );

    root.querySelectorAll<HTMLElement>("[data-lib-id]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [primeVideo]);

  const close = useCallback(() => setSelectedId(null), []);
  const open = useCallback((item: LibraryItem) => setSelectedId(item.id), []);

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
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-8">
        <div className="mx-auto grid max-w-3xl grid-cols-3 gap-3 sm:grid-cols-4 sm:gap-4">
          {shuffledItems.map((item, index) => (
            <button
              key={item.id}
              type="button"
              data-lib-id={item.id}
              onClick={() => open(item)}
              onPointerEnter={() => primeVideo(item)}
              onPointerDown={() => primeVideo(item)}
              aria-label={`Ouvrir ${item.title}`}
              className="group relative aspect-square overflow-hidden rounded-2xl border border-pink-500/50 bg-black/60 transition active:scale-95"
              style={{
                boxShadow: "0 0 14px rgba(255,20,147,0.35)",
              }}
            >
              {/* Vignette WebP ultra légère : aucune vidéo n'est chargée ici. */}
              <img
                src={item.thumbnail}
                alt={item.title}
                loading={index < 9 ? "eager" : "lazy"}
                decoding="async"
                draggable={false}
                className={
                  item.type === "video"
                    ? "h-full w-full object-cover opacity-60 transition duration-300 group-hover:scale-105 group-hover:opacity-100"
                    : "h-full w-full object-cover transition duration-300 group-hover:scale-105"
                }
              />
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
          onClick={close}
        >
          {selected.type === "photo" ? (
            <img
              src={selected.src}
              alt={selected.title}
              decoding="async"
              className="max-h-[75vh] max-w-full rounded-2xl border border-pink-400/60 object-contain shadow-[0_0_40px_rgba(255,20,147,0.5)]"
            />
          ) : (
            <VideoStage item={selected} />
          )}
          <p className="glow-text text-xl font-semibold tracking-widest sm:text-2xl">
            {selected.title}
          </p>
          <button
            type="button"
            onClick={close}
            className="glow-button rounded-full border border-pink-400/70 bg-pink-500/20 px-10 py-2 text-sm font-semibold tracking-widest text-pink-100 uppercase transition hover:bg-pink-500/40 active:scale-95 sm:text-base"
          >
            Fermer
          </button>
        </div>
      )}
    </section>
  );
}
