#include "distortion.h"
#include "plugin_ids.h"
#include <math.h>

void distortion_init(Distortion* d) {
    d->enabled = 1;
    d->drive   = 0.f;
    d->mode    = 0.f;
    d->mix     = 100.f;
}

void distortion_set_param(Distortion* d, int param_id, float value) {
    switch (param_id) {
        case DIST_PARAM_ENABLED: d->enabled = (value >= 0.5f); break;
        case DIST_PARAM_DRIVE:   d->drive   = value;           break;
        case DIST_PARAM_MODE:    d->mode    = value;           break;
        case DIST_PARAM_MIX:     d->mix     = value;           break;
    }
}

/* Process a single sample through the selected distortion algorithm. */
static float distort_sample(float x, int mode) {
    if (mode == 1) {
        /* Hard clip */
        return x > 1.f ? 1.f : x < -1.f ? -1.f : x;
    } else if (mode == 2) {
        /* Fuzz — asymmetric heavy distortion */
        return x >= 0.f ? 1.f - expf(-x) : -tanhf(-x * 2.f);
    } else {
        /* Soft clip (tanh) — default mode 0 */
        return tanhf(x);
    }
}

void distortion_process(Distortion* d, float in_L, float in_R,
                        float* out_L, float* out_R) {
    if (!d->enabled || d->drive < 0.001f) {
        *out_L = in_L;
        *out_R = in_R;
        return;
    }

    /* Pre-gain: 0 dB (drive=0) to +40 dB (drive=100) */
    float pregain = powf(10.f, d->drive * 0.04f);
    float mix01   = d->mix * 0.01f;
    int   mode    = (int)d->mode;

    float wet_L = distort_sample(in_L * pregain, mode);
    float wet_R = distort_sample(in_R * pregain, mode);

    *out_L = in_L * (1.f - mix01) + wet_L * mix01;
    *out_R = in_R * (1.f - mix01) + wet_R * mix01;
}
