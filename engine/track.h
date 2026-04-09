#ifndef TRACK_H
#define TRACK_H

#include "eq.h"

#define MAX_TRACKS 32

typedef struct {
    /* PCM data — separate L/R planes, float32 */
    float*  pcm_L;
    float*  pcm_R;
    long    num_frames;   /* total frames (not samples) */
    long    start_frame;  /* global playhead offset for this slot (default 0) */
    int     active;       /* slot in use */

    /* Mix params */
    float   gain;         /* 0.0 - 2.0, default 1.0 */
    float   pan;          /* -1.0 (L) to 1.0 (R), default 0.0 */
    int     muted;
    int     soloed;

    TrackEQ eq;
} Track;

void track_init  (Track* t, float sample_rate);
void track_reset (Track* t);
void track_free  (Track* t);

/* Process one frame. Returns stereo sample via out_L/out_R. */
void track_process_frame(Track* t, long playhead,
                         float* out_L, float* out_R);

#endif
