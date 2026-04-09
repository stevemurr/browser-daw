#!/bin/bash
set -e

EXPORTED_FUNCTIONS='[
  "_engine_add_track",
  "_engine_remove_track",
  "_engine_get_track_count",
  "_engine_set_gain",
  "_engine_set_pan",
  "_engine_set_mute",
  "_engine_set_solo",
  "_engine_plugin_set_param",
  "_engine_play",
  "_engine_pause",
  "_engine_seek",
  "_engine_get_playhead",
  "_engine_is_playing",
  "_engine_set_master_gain",
  "_engine_set_start_frame",
  "_engine_process",
  "_engine_alloc_pcm",
  "_engine_free_pcm",
  "_malloc",
  "_free"
]'

emcc \
  engine.c track.c eq.c compressor.c distortion.c limiter.c delay.c chorus.c reverb.c \
  -O2 \
  -lm \
  -s WASM=1 \
  -s EXPORTED_FUNCTIONS="$EXPORTED_FUNCTIONS" \
  -s EXPORTED_RUNTIME_METHODS='["HEAPF32","HEAP32","HEAPU8"]' \
  -s INITIAL_MEMORY=67108864 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME="AudioEngineModule" \
  -s ENVIRONMENT=web \
  -o ../public/audio_engine.js

echo "Build complete → public/audio_engine.js + public/audio_engine.wasm"
