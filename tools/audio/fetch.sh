#!/usr/bin/env bash
# Pulls each clip in list.tsv from YouTube, trims, normalizes, writes public/audio/<name>.ogg
set -u
cd "$(dirname "$0")/../.."
mkdir -p /tmp/rr_audio public/audio
while IFS=$'\t' read -r name url start end; do
  [ -f "public/audio/$name.ogg" ] && continue
  rm -f /tmp/rr_audio/$name.*
  yt-dlp -q </dev/null --no-warnings --no-playlist -x --audio-format wav -o "/tmp/rr_audio/$name.%(ext)s" "$url" || { echo "FAIL $name"; continue; }
  ffmpeg -nostdin -y -loglevel error -ss "$start" -to "$end" -i "/tmp/rr_audio/$name.wav" \
    -af "loudnorm=I=-18:TP=-1.5:LRA=11,afade=t=in:d=0.02" -ac 2 -ar 48000 -c:a libvorbis -q:a 5 "public/audio/$name.ogg" && echo "OK $name"
done < tools/audio/list.tsv
