import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Couleur de fond de l'app (noir violacé) — utilisée par le splash et la barre d'état. */
const APP_BACKGROUND = "#0a0006";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "favicon-96x96.png", "apple-touch-icon.png"],
      workbox: {
        // Le shell (HTML + JS + CSS + icônes) est précaché : l'app démarre hors
        // ligne. Les médias de la bibliothèque (≈50 Mo) restent exclus du
        // précache et sont mis en cache au fil des consultations.
        globIgnores: ["assets/library/**", "assets/galaxy/**"],

        // Indispensable : sans ça, ouvrir l'app hors ligne aboutit à un écran
        // blanc (le précache contient index.html mais aucune navigation ne le
        // trouve).
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/assets\//],

        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,

        runtimeCaching: [
          {
            // Vidéos de la bibliothèque : lues depuis le cache une fois vues.
            urlPattern: /\/assets\/library\/[^/]+\.mp4$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "souvenirs-videos",
              expiration: {
                // 63 vidéos + marge : la galerie entière tient dans le cache.
                maxEntries: 80,
                maxAgeSeconds: 60 * 60 * 24 * 90,
              },
              cacheableResponse: { statuses: [0, 200] },
              // Indispensable : sans ça, le seek ne fonctionne pas sur une
              // réponse mise en cache (206 Partial Content).
              rangeRequests: true,
              plugins: [
                {
                  /**
                   * Le lecteur vidéo demande toujours des plages (206), et
                   * Workbox ne met en cache que les réponses complètes : sans
                   * ce correctif, aucune vidéo n'était jamais stockée et la
                   * galerie n'était pas consultable hors ligne.
                   *
                   * On récupère donc le fichier entier une seule fois pour les
                   * requêtes du lecteur (`destination === "video"`), puis
                   * `RangeRequestsPlugin` découpe les plages demandées depuis
                   * cette copie complète.
                   */
                  requestWillFetch: async ({ request }: { request: Request }) => {
                    if (request.destination !== "video") return request;
                    const headers = new Headers(request.headers);
                    headers.delete("range");
                    return new Request(request.url, {
                      headers,
                      credentials: "same-origin",
                    });
                  },
                },
              ],
            },
          },
          {
            // Vignettes WebP : affichage instantané dès la deuxième visite.
            urlPattern: /\/assets\/(library|galaxy)\/thumbs\/[^/]+\.webp$/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "souvenirs-vignettes",
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 90,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Photos en grand format (visionneuse plein écran).
            urlPattern: /\/assets\/(library|galaxy)\/[^/]+\.jpe?g$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "souvenirs-photos",
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 90,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        id: "./",
        name: "Madame Flex",
        short_name: "Mme Flex",
        description: "Site officiel de Madame Flex",
        lang: "fr",
        dir: "ltr",
        start_url: "./",
        scope: "./",
        display: "standalone",
        orientation: "portrait",
        theme_color: APP_BACKGROUND,
        background_color: APP_BACKGROUND,
        categories: ["lifestyle", "photo"],
        icons: [
          {
            src: "web-app-manifest-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "web-app-manifest-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "web-app-manifest-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
