#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Optimise les médias de la bibliothèque pour un chargement rapide.
#
#   1. Vignettes WebP 480px  -> public/assets/library/thumbs/
#   2. Vidéos H.264 compressées -> public/assets/library/  (mêmes noms)
#
# Les originaux non compressés restent dans medias/bibliotech_numerique/.
# Relancer le script est sans danger : les fichiers déjà générés sont sautés.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/medias/bibliotech_numerique"
OUT="$ROOT/public/assets/library"
THUMBS="$OUT/thumbs"

# Réglages d'encodage. CRF plus haut = fichier plus petit mais plus flou.
# `scale` ne fait jamais d'upscale : la vidéo tient dans une boîte de 854px de
# côté maximum, portrait comme paysage, avec des dimensions paires.
CRF="${CRF:-30}"
SCALE="${SCALE:-w='min(iw,800)':h='min(ih,800)':force_original_aspect_ratio=decrease:force_divisible_by=2}"
ABITRATE="${ABITRATE:-48k}"
FORCE="${FORCE:-0}"

mkdir -p "$THUMBS"
# Nettoie les fichiers temporaires laissés par une exécution interrompue.
rm -f "$OUT"/*.tmp.mp4

slug() {
  # "WhatsApp Video 2026-10-24 at 07.01.05.mp4" -> "...-07-01-05"
  local base="${1%.*}"
  printf '%s' "$base" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -e 's/[^a-z0-9]\+/-/g' -e 's/^-//' -e 's/-$//'
}

# ---------------------------------------------------------------- vignettes
echo "==> Vignettes WebP (480x270)"
count=0
for f in "$OUT"/*.mp4 "$OUT"/*.jpeg; do
  [ -e "$f" ] || continue
  name="$(basename "$f")"
  case "$name" in
    *.tmp.mp4 | *.tmp) continue ;;
  esac
  thumb="$THUMBS/$(slug "$name").webp"
  if [ -s "$thumb" ]; then
    continue
  fi

  case "$name" in
    *.mp4)
      # Une image ~1 s après le début (ou la première si la vidéo est très courte)
      ffmpeg -nostdin -v error -y -ss 1 -i "$f" -frames:v 1 \
        -vf "scale=480:-2" -c:v libwebp -quality 72 -compression_level 6 \
        "$thumb" 2>/dev/null \
        || ffmpeg -nostdin -v error -y -i "$f" -frames:v 1 \
             -vf "scale=480:-2" -c:v libwebp -quality 72 \
             -compression_level 6 "$thumb" \
        || echo "  ! vignette impossible : $name"
      ;;
    *.jpeg)
      ffmpeg -nostdin -v error -y -i "$f" -frames:v 1 \
        -vf "scale=480:-2" -c:v libwebp -quality 72 -compression_level 6 \
        "$thumb" \
        || echo "  ! vignette impossible : $name"
      ;;
  esac
  count=$((count + 1))
  printf '\r  %d vignette(s) générée(s)' "$count"
done
echo
echo "    -> $(ls -1 "$THUMBS" | wc -l) fichier(s) dans thumbs/ ($(du -sh "$THUMBS" | cut -f1))"

# ------------------------------------------------------------------- vidéos
echo "==> Compression des vidéos (H.264, $SCALE, CRF $CRF)"
count=0
for src in "$SRC"/*.mp4; do
  [ -e "$src" ] || continue
  name="$(basename "$src")"
  dst="$OUT/$name"

  src_size=$(stat -c %s "$src")
  if [ "$FORCE" != "1" ] && [ -s "$dst" ]; then
    dst_size=$(stat -c %s "$dst")
    if [ "$dst_size" -lt "$src_size" ]; then
      continue
    fi
  fi

  tmp="$dst.tmp.mp4"
  ffmpeg -nostdin -v error -y -i "$src" \
    -vf "scale=$SCALE" \
    -c:v libx264 -preset medium -crf "$CRF" -profile:v high -level 4.0 \
    -pix_fmt yuv420p -g 60 \
    -c:a aac -b:a "$ABITRATE" -ac 1 \
    -movflags +faststart \
    "$tmp"

  # Garde-fou : si l'encodage n'a rien gagné, on conserve l'original.
  if [ "$(stat -c %s "$tmp")" -ge "$src_size" ]; then
    cp "$src" "$tmp"
  fi
  mv "$tmp" "$dst"
  count=$((count + 1))

  printf '\r  %d vidéo(s) compressée(s)' "$count"
done
echo
echo "    -> $(du -sh "$OUT" | cut -f1) au total ($(ls -1 "$OUT"/*.mp4 | wc -l) vidéos, $(ls -1 "$OUT"/*.jpeg | wc -l) photos)"
echo "Terminé."
