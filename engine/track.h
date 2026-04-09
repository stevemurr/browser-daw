#ifndef TRACK_H
#define TRACK_H

#include "eq.h"
#include "compressor.h"
#include "distortion.h"
#include "limiter.h"
#include "delay.h"
#include "chorus.h"
#include "reverb.h"

#define MAX_TRACKS 32

typedef struct {
    /* Chunked PCM — double-buffered sliding window of the source file.
       chunk_L/R  — currently playing chunk (active from chunk_start).
       next_chunk_L/R — prefetched chunk queued for seamless crossover.
         Promoted to current in track_process_frame() when the playhead
         reaches next_chunk_start, so the old chunk stays alive until then
         and there is never a gap in audio output at chunk boundaries.
       All pointers are WASM-heap-owned; freed when swapped or on track_free(). */
    float*  chunk_L;
    float*  chunk_R;
    long    chunk_start;        /* source-file frame offset of chunk[0] */
    long    chunk_length;       /* frames in this chunk (may be < CHUNK_FRAMES at EOF) */
    float*  next_chunk_L;       /* queued prefetch chunk, NULL if none */
    float*  next_chunk_R;
    long    next_chunk_start;
    long    next_chunk_length;
    long    num_frames;         /* total frames in source file */
    long    start_frame;   /* global timeline offset: playhead==start_frame → src_frame==0 */
    int     active;        /* slot in use */

    /* Mix params */
    float   gain;         /* 0.0 - 2.0, default 1.0 */
    float   pan;          /* -1.0 (L) to 1.0 (R), default 0.0 */
    int     muted;
    int     soloed;

    TrackEQ    eq;
    Compressor compressor;
    Distortion distortion;
    Limiter    limiter;
    Delay      delay;
    Chorus     chorus;
    Reverb     reverb;
} Track;

void track_init  (Track* t, float sample_rate);
void track_reset (Track* t);
void track_free  (Track* t);

/* Process one frame. Returns stereo sample via out_L/out_R. */
void track_process_frame(Track* t, long playhead,
                         float* out_L, float* out_R);

#endif
