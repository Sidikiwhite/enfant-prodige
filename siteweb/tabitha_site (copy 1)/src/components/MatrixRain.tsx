import { useEffect, useRef } from "react";

const GLYPHS =
  "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789";
const FRAME_MS = 1000 / 30; // ~30 fps: smooth enough and light on phones

export default function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let fontSize = 16;
    let columns = 0;
    let drops: number[] = [];
    let rafId = 0;
    let lastFrame = 0;

    const makeDrop = () => Math.random() * (height / fontSize);

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      fontSize = width < 640 ? 14 : 18;
      const newColumns = Math.ceil(width / fontSize);
      // Keep existing drops when the size changes (e.g. mobile URL bar),
      // so the rain does not jump around.
      if (newColumns > columns) {
        for (let i = columns; i < newColumns; i++) drops[i] = makeDrop();
      } else {
        drops = drops.slice(0, newColumns);
      }
      columns = newColumns;

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
    };

    const draw = (now: number) => {
      rafId = requestAnimationFrame(draw);
      if (now - lastFrame < FRAME_MS) return;
      lastFrame = now;

      // Translucent black veil creates the fading trails.
      ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
      ctx.fillRect(0, 0, width, height);

      ctx.font = `${fontSize}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.textBaseline = "top";

      for (let i = 0; i < columns; i++) {
        const glyph = GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length));
        const x = i * fontSize;
        const y = drops[i] * fontSize;

        // Bright pink-white head; it darkens into pink as the veil fades it.
        ctx.fillStyle = Math.random() > 0.9 ? "#ffffff" : "#ff8cc8";
        ctx.fillText(glyph, x, y);

        if (y > height && Math.random() > 0.975) {
          drops[i] = 0;
        } else {
          drops[i] += 1;
        }
      }
    };

    resize();
    window.addEventListener("resize", resize);
    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 block"
    />
  );
}
