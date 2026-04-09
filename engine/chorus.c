#include "chorus.h"
#include "plugin_ids.h"
#include <math.h>
#include <string.h>

void chorus_init(Chorus* c, float sample_rate) {
    c->enabled     = 1;
    c->rate        = 0.5f;
    c->depth       = 0.4f;   /* 40% → 0.4 */
    c->mix         = 0.0f;   /* start dry — user enables mix deliberately */
    c->write_pos   = 0;
    c->lfo_phase   = 0.f;
    c->sample_rate = sample_rate;
    c->lfo_inc     = 6.28318530f * c->rate / sample_rate;
    memset(c->buf_L, 0, sizeof(c->buf_L));
    memset(c->buf_R, 0, sizeof(c->buf_R));
}

void chorus_set_param(Chorus* c, int param_id, float value) {
    switch (param_id) {
        case CHORUS_PARAM_ENABLED:
            c->enabled = (value >= 0.5f);
            break;
        case CHORUS_PARAM_RATE:
            c->rate    = value;
            c->lfo_inc = 6.28318530f * value / c->sample_rate;
            break;
        case CHORUS_PARAM_DEPTH:
            c->depth = value * 0.01f;
            break;
        case CHORUS_PARAM_MIX:
            c->mix = value * 0.01f;
            break;
    }
}

void chorus_process(Chorus* c, float in_L, float in_R,
                    float* out_L, float* out_R) {
    if (!c->enabled) {
        *out_L = in_L;
        *out_R = in_R;
        return;
    }

    /* Delay modulation */
    float center_ms = 10.f;
    float swing_ms  = c->depth * 10.f;
    float mod_ms    = center_ms + swing_ms * sinf(c->lfo_phase);
    float delay_samples_f = mod_ms * c->sample_rate / 1000.f;

    /* Linear interpolation in circular buffer */
    int   d0   = (int)delay_samples_f;
    float frac = delay_samples_f - (float)d0;
    int   d1   = d0 + 1;

    int r0 = (c->write_pos - d0 + CHORUS_BUF_SIZE) % CHORUS_BUF_SIZE;
    int r1 = (c->write_pos - d1 + CHORUS_BUF_SIZE) % CHORUS_BUF_SIZE;

    float wet_L = c->buf_L[r0] * (1.f - frac) + c->buf_L[r1] * frac;
    float wet_R = c->buf_R[r0] * (1.f - frac) + c->buf_R[r1] * frac;

    /* Write current input into buffer */
    c->buf_L[c->write_pos] = in_L;
    c->buf_R[c->write_pos] = in_R;
    c->write_pos = (c->write_pos + 1) % CHORUS_BUF_SIZE;

    /* Mix and advance LFO */
    *out_L = in_L * (1.f - c->mix) + wet_L * c->mix;
    *out_R = in_R * (1.f - c->mix) + wet_R * c->mix;
    c->lfo_phase += c->lfo_inc;
    if (c->lfo_phase >= 6.28318530f) c->lfo_phase -= 6.28318530f;
}

void chorus_reset(Chorus* c) {
    memset(c->buf_L, 0, sizeof(c->buf_L));
    memset(c->buf_R, 0, sizeof(c->buf_R));
    c->write_pos = 0;
    c->lfo_phase = 0.f;
}
