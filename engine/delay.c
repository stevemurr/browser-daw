#include "delay.h"
#include "plugin_ids.h"
#include <stdlib.h>
#include <string.h>

void delay_init(Delay* d, float sample_rate) {
    d->sample_rate = sample_rate;
    d->enabled     = 1;
    d->time_ms     = 250.f;
    d->feedback    = 0.35f;   /* 35% → 0.35 */
    d->mix         = 0.0f;    /* start dry — user enables mix deliberately */
    d->buf_size    = DELAY_MAX_SAMPLES;
    d->write_pos   = 0;

    d->buf_L = (float*)malloc(DELAY_MAX_SAMPLES * sizeof(float));
    d->buf_R = (float*)malloc(DELAY_MAX_SAMPLES * sizeof(float));

    if (d->buf_L) memset(d->buf_L, 0, DELAY_MAX_SAMPLES * sizeof(float));
    if (d->buf_R) memset(d->buf_R, 0, DELAY_MAX_SAMPLES * sizeof(float));
}

void delay_set_param(Delay* d, int param_id, float value) {
    switch (param_id) {
        case DELAY_PARAM_ENABLED:
            d->enabled = (value >= 0.5f);
            break;
        case DELAY_PARAM_TIME_MS:
            if (value <    1.f) value =    1.f;
            if (value > 2000.f) value = 2000.f;
            d->time_ms = value;
            break;
        case DELAY_PARAM_FEEDBACK:
            /* UI sends 0-95 percent; store as 0-0.95 fraction */
            d->feedback = value * 0.01f;
            break;
        case DELAY_PARAM_MIX:
            /* UI sends 0-100 percent; store as 0-1 fraction */
            d->mix = value * 0.01f;
            break;
    }
}

void delay_process(Delay* d, float in_L, float in_R,
                   float* out_L, float* out_R) {
    int delay_samples = (int)(d->time_ms * d->sample_rate * 0.001f);
    if (delay_samples < 1) delay_samples = 1;
    if (delay_samples >= d->buf_size) delay_samples = d->buf_size - 1;

    int read_pos = (d->write_pos - delay_samples + d->buf_size) % d->buf_size;

    float delayed_L = d->buf_L[read_pos];
    float delayed_R = d->buf_R[read_pos];

    /* Write: input + feedback regardless of enabled (keeps buffer state) */
    d->buf_L[d->write_pos] = in_L + delayed_L * d->feedback;
    d->buf_R[d->write_pos] = in_R + delayed_R * d->feedback;
    d->write_pos = (d->write_pos + 1) % d->buf_size;

    if (!d->enabled) {
        *out_L = in_L;
        *out_R = in_R;
        return;
    }

    /* Mix dry + wet */
    *out_L = in_L * (1.f - d->mix) + delayed_L * d->mix;
    *out_R = in_R * (1.f - d->mix) + delayed_R * d->mix;
}

void delay_reset(Delay* d) {
    if (d->buf_L) memset(d->buf_L, 0, DELAY_MAX_SAMPLES * sizeof(float));
    if (d->buf_R) memset(d->buf_R, 0, DELAY_MAX_SAMPLES * sizeof(float));
    d->write_pos = 0;
}

void delay_free(Delay* d) {
    if (d->buf_L) { free(d->buf_L); d->buf_L = NULL; }
    if (d->buf_R) { free(d->buf_R); d->buf_R = NULL; }
}
