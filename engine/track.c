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
}

void track_free(Track* t) {
    if (t->pcm_L) { free(t->pcm_L); t->pcm_L = NULL; }
    if (t->pcm_R) { free(t->pcm_R); t->pcm_R = NULL; }
    t->active = 0;
}

void track_process_frame(Track* t, long playhead,
                         float* out_L, float* out_R) {
    *out_L = 0.0f;
    *out_R = 0.0f;

    long local = playhead - t->start_frame;
    if (!t->active || !t->pcm_L || local < 0 || local >= t->num_frames) return;

    float raw_L = t->pcm_L[local];
    float raw_R = t->pcm_R ? t->pcm_R[local] : raw_L; /* mono fallback */

    /* Apply EQ */
    float eq_L = eq_process_sample(&t->eq, raw_L, 0);
    float eq_R = eq_process_sample(&t->eq, raw_R, 1);

    /* Pan law: constant power (-3dB center) */
    float pan_angle = (t->pan + 1.0f) * 0.25f * 3.14159265f; /* 0 to pi/2 */
    float pan_L = cosf(pan_angle);
    float pan_R = sinf(pan_angle);

    *out_L = eq_L * t->gain * pan_L;
    *out_R = eq_R * t->gain * pan_R;
}
