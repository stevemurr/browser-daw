#include "limiter.h"
#include "plugin_ids.h"
#include <math.h>

/* Compute per-sample release coefficient from release_ms and sample_rate. */
static float compute_rel_coeff(float release_ms, float sample_rate) {
    if (release_ms <= 0.f || sample_rate <= 0.f) return 1.f;
    return 1.f - expf(-1.f / (release_ms * sample_rate * 0.001f));
}

void limiter_init(Limiter* l, float sample_rate) {
    l->enabled       = 1;
    l->threshold_db  = -0.3f;
    l->release_ms    = 100.f;
    l->gain_lin      = 1.f;
    l->sample_rate   = sample_rate;
    l->rel_coeff     = compute_rel_coeff(l->release_ms, sample_rate);
}

void limiter_set_param(Limiter* l, int param_id, float value) {
    switch (param_id) {
        case LIM_PARAM_ENABLED:
            l->enabled = (value >= 0.5f);
            break;
        case LIM_PARAM_THRESHOLD:
            if (value < -24.f) value = -24.f;
            if (value >   0.f) value =   0.f;
            l->threshold_db = value;
            break;
        case LIM_PARAM_RELEASE:
            if (value <  10.f) value =  10.f;
            if (value > 500.f) value = 500.f;
            l->release_ms = value;
            l->rel_coeff  = compute_rel_coeff(value, l->sample_rate);
            break;
    }
}

void limiter_process(Limiter* l, float in_L, float in_R,
                     float* out_L, float* out_R) {
    if (!l->enabled) {
        *out_L = in_L;
        *out_R = in_R;
        return;
    }

    float thresh_lin = powf(10.f, l->threshold_db / 20.f);

    /* Peak of the louder channel (linked stereo). */
    float abs_L = in_L < 0.f ? -in_L : in_L;
    float abs_R = in_R < 0.f ? -in_R : in_R;
    float peak  = abs_L > abs_R ? abs_L : abs_R;

    if (peak * l->gain_lin > thresh_lin) {
        /* Instantaneous attack: clamp gain so peak * gain == thresh_lin. */
        if (peak > 1e-9f) {
            l->gain_lin = thresh_lin / peak;
        }
    } else {
        /* Release: smoothly let gain rise back toward 1.0. */
        l->gain_lin += l->rel_coeff * (1.f - l->gain_lin);
        if (l->gain_lin > 1.f) l->gain_lin = 1.f;
    }

    *out_L = in_L * l->gain_lin;
    *out_R = in_R * l->gain_lin;
}

void limiter_reset(Limiter* l) {
    l->gain_lin = 1.f;
}
