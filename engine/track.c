#include "track.h"
#include <stdlib.h>
#include <string.h>
#include <math.h>

void track_init(Track* t, float sample_rate) {
    memset(t, 0, sizeof(Track));
    t->gain   = 1.0f;
    t->pan    = 0.0f;
    t->muted  = 0;
    t->soloed = 0;
    t->active = 0;
    eq_init(&t->eq, sample_rate);
    compressor_init(&t->compressor, sample_rate);
    distortion_init(&t->distortion);
    limiter_init(&t->limiter, sample_rate);
    delay_init(&t->delay, sample_rate);
    chorus_init(&t->chorus, sample_rate);
    reverb_init(&t->reverb, sample_rate);
}

void track_free(Track* t) {
    if (t->chunk_L)      { free(t->chunk_L);      t->chunk_L      = NULL; }
    if (t->chunk_R)      { free(t->chunk_R);       t->chunk_R      = NULL; }
    if (t->next_chunk_L) { free(t->next_chunk_L);  t->next_chunk_L = NULL; }
    if (t->next_chunk_R) { free(t->next_chunk_R);  t->next_chunk_R = NULL; }
    delay_free(&t->delay);
    t->active = 0;
}

void track_process_frame(Track* t, long playhead,
                         float* out_L, float* out_R) {
    *out_L = 0.0f;
    *out_R = 0.0f;

    /* src_frame: position within the source file.
       chunk_local: position within the currently loaded chunk.
       Output silence on cache miss (chunk not yet loaded or gap). */
    long src_frame = playhead - t->start_frame;

    /* Seamless chunk promotion: if the prefetched next chunk is ready and
       the playhead has reached its start, swap it in before reading audio.
       This keeps the previous chunk alive until the boundary so there is
       no silence gap during the handover. */
    if (t->next_chunk_L && src_frame >= t->next_chunk_start) {
        if (t->chunk_L) free(t->chunk_L);
        if (t->chunk_R) free(t->chunk_R);
        t->chunk_L      = t->next_chunk_L;
        t->chunk_R      = t->next_chunk_R;
        t->chunk_start  = t->next_chunk_start;
        t->chunk_length = t->next_chunk_length;
        t->next_chunk_L = NULL;
        t->next_chunk_R = NULL;
    }

    long chunk_local = src_frame - t->chunk_start;
    if (!t->active || !t->chunk_L || src_frame < 0 || src_frame >= t->num_frames
        || chunk_local < 0 || chunk_local >= t->chunk_length) return;

    float raw_L = t->chunk_L[chunk_local];
    float raw_R = t->chunk_R ? t->chunk_R[chunk_local] : raw_L; /* mono fallback */

    /* Signal chain: EQ → Compressor → Distortion → Limiter → Delay → Chorus → Reverb */
    float eq_L = eq_process_sample(&t->eq, raw_L, 0);
    float eq_R = eq_process_sample(&t->eq, raw_R, 1);

    float comp_L, comp_R;
    compressor_process(&t->compressor, eq_L, eq_R, &comp_L, &comp_R);

    float dist_L, dist_R;
    distortion_process(&t->distortion, comp_L, comp_R, &dist_L, &dist_R);

    float lim_L, lim_R;
    limiter_process(&t->limiter, dist_L, dist_R, &lim_L, &lim_R);

    float del_L, del_R;
    delay_process(&t->delay, lim_L, lim_R, &del_L, &del_R);

    float cho_L, cho_R;
    chorus_process(&t->chorus, del_L, del_R, &cho_L, &cho_R);

    float rev_L, rev_R;
    reverb_process(&t->reverb, cho_L, cho_R, &rev_L, &rev_R);

    /* Pan law: constant power (-3dB center) */
    float pan_angle = (t->pan + 1.0f) * 0.25f * 3.14159265f; /* 0 to pi/2 */
    float pan_L = cosf(pan_angle);
    float pan_R = sinf(pan_angle);

    *out_L = rev_L * t->gain * pan_L;
    *out_R = rev_R * t->gain * pan_R;
}
