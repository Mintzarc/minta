#!/usr/bin/env bash
# Cuts splash assets from a source film (a 960x960, 10 s, silent H.264 clip, about 10 MB):
#   public/splash/minta-splash<suffix>.mp4          720x720, H.264 main, no audio, faststart, about 1.2 MB
#   public/splash/minta-splash<suffix>-poster.webp   its first frame, shown while the film loads
# The source films are not in the repo (about 10 MB each); give the path, and a suffix for every film after the first (-2, -3 ...).
# Then list the film in src/lib/films.ts; with several films the splash plays them in turn. Needs ffmpeg with libx264
# (FFMPEG=<binary>, default ffmpeg).
#   bash brand/splash/make-assets.sh path/to/film.mp4          the first film (minta-splash.mp4)
#   bash brand/splash/make-assets.sh path/to/other.mp4 -2      the second (minta-splash-2.mp4)
set -euo pipefail
src="${1:?usage: make-assets.sh <source film> [suffix]}"
suffix="${2:-}"
ff="${FFMPEG:-ffmpeg}"
out="$(cd "$(dirname "$0")/../.." && pwd)/public/splash"
mkdir -p "$out"
"$ff" -hide_banner -loglevel error -y -i "$src" -an -vf "scale=720:720:flags=lanczos" \
  -c:v libx264 -profile:v main -level 3.1 -pix_fmt yuv420p -preset veryslow -crf 30 -movflags +faststart -tag:v avc1 "$out/minta-splash${suffix}.mp4"
"$ff" -hide_banner -loglevel error -y -i "$src" -frames:v 1 -vf "scale=720:720:flags=lanczos" -c:v libwebp -quality 80 "$out/minta-splash${suffix}-poster.webp"
ls -l "$out"
