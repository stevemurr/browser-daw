#include "eq.h"
#include "plugin_ids.h"
#include <math.h>
#include <string.h>

#define PI 3.14159265358979323846f

static void compute_coeffs(Biquad* f,
                            float b0, float b1, float b2,
                            float a0, float a1, float a2) {
    f->b0 =  b0 / a0;
    f->b1 =  b1 / a0;
    f->b2 =  b2 / a0;
    f->a1 =  a1 / a0;
    f->a2 =  a2 / a0;
}

void biquad_reset(Biquad* f) {
    f->x1 = f->x2 = f->y1 = f->y2 = 0.0f;
}

float biquad_process(Biquad* f, float x) {
    float y = f->b0*x + f->b1*f->x1 + f->b2*f->x2
                      - f->a1*f->y1  - f->a2*f->y2;
    f->x2 = f->x1; f->x1 = x;
    f->y2 = f->y1; f->y1 = y;
    return y;
}

void biquad_set_lowshelf(Biquad* f, float freq, float gain_db, float q, float sr) {
    float A  = powf(10.0f, gain_db / 40.0f);
    float w0 = 2.0f * PI * freq / sr;
    float cw = cosf(w0);
    float sw = sinf(w0);
    float al = sw / (2.0f * q);
    float sq = 2.0f * sqrtf(A) * al;

    compute_coeffs(f,
        A*((A+1) - (A-1)*cw + sq),
        2*A*((A-1) - (A+1)*cw),
        A*((A+1) - (A-1)*cw - sq),
        (A+1) + (A-1)*cw + sq,
        -2*((A-1) + (A+1)*cw),
        (A+1) + (A-1)*cw - sq
    );
}

void biquad_set_highshelf(Biquad* f, float freq, float gain_db, float q, float sr) {
    float A  = powf(10.0f, gain_db / 40.0f);
    float w0 = 2.0f * PI * freq / sr;
    float cw = cosf(w0);
    float sw = sinf(w0);
    float al = sw / (2.0f * q);
    float sq = 2.0f * sqrtf(A) * al;

    compute_coeffs(f,
        A*((A+1) + (A-1)*cw + sq),
        -2*A*((A-1) + (A+1)*cw),
        A*((A+1) + (A-1)*cw - sq),
        (A+1) - (A-1)*cw + sq,
        2*((A-1) - (A+1)*cw),
        (A+1) - (A-1)*cw - sq
    );
}

void biquad_set_peak(Biquad* f, float freq, float gain_db, float q, float sr) {
    float A  = powf(10.0f, gain_db / 40.0f);
    float w0 = 2.0f * PI * freq / sr;
    float cw = cosf(w0);
    float al = sinf(w0) / (2.0f * q);

    compute_coeffs(f,
        1 + al*A,
        -2*cw,
        1 - al*A,
        1 + al/A,
        -2*cw,
        1 - al/A
    );
}

void eq_init(TrackEQ* eq, float sample_rate) {
    memset(eq, 0, sizeof(TrackEQ));
    eq->enabled = 1;
    /* Defaults: 80Hz low shelf, 1kHz mid peak, 8kHz high shelf */
    eq_set_band(eq, 0, BAND_LOW_SHELF,  80.0f,   0.0f, 0.707f, sample_rate);
    eq_set_band(eq, 1, BAND_MID_PEAK,   1000.0f, 0.0f, 0.707f, sample_rate);
    eq_set_band(eq, 2, BAND_HIGH_SHELF, 8000.0f, 0.0f, 0.707f, sample_rate);
}

void eq_set_band(TrackEQ* eq, int band, BandType type,
                 float freq, float gain_db, float q, float sample_rate) {
    if (band < 0 || band > 2) return;
    EQBand* b = &eq->bands[band];
    b->freq    = freq;
    b->gain_db = gain_db;
    b->q       = q;
    b->type    = type;
    b->enabled = 1;

    for (int ch = 0; ch < 2; ch++) {
        biquad_reset(&b->filters[ch]);
        switch (type) {
            case BAND_LOW_SHELF:
                biquad_set_lowshelf (&b->filters[ch], freq, gain_db, q, sample_rate);
                break;
            case BAND_MID_PEAK:
                biquad_set_peak     (&b->filters[ch], freq, gain_db, q, sample_rate);
                break;
            case BAND_HIGH_SHELF:
                biquad_set_highshelf(&b->filters[ch], freq, gain_db, q, sample_rate);
                break;
        }
    }
}

void eq_set_param(TrackEQ* eq, int param_id, float value, float sample_rate) {
    /* Global EQ bypass */
    if (param_id == EQ_PARAM_ENABLED) {
        eq->enabled = (value >= 0.5f) ? 1 : 0;
        return;
    }

    /* Band params: param_id 1-9, band = (param_id-1)/3, field = (param_id-1)%3 */
    int idx   = param_id - 1;          /* 0-8 */
    int band  = idx / 3;               /* 0, 1, or 2 */
    int field = idx % 3;               /* 0=freq 1=gain_db 2=q */
    if (band < 0 || band > 2) return;

    EQBand* b = &eq->bands[band];
    switch (field) {
        case 0: b->freq    = value; break;
        case 1: b->gain_db = value; break;
        case 2: b->q       = value; break;
    }

    /* Recompute biquad coefficients with the updated params.
       Do NOT reset filter state (x1/x2/y1/y2) — the delay-line history is still
       valid signal data.  Zeroing it causes a one-sample discontinuity heard as a
       click.  Leaving it intact lets the filter transition naturally to the new
       frequency response without any audible artifact. */
    for (int ch = 0; ch < 2; ch++) {
        switch (b->type) {
            case BAND_LOW_SHELF:
                biquad_set_lowshelf (&b->filters[ch], b->freq, b->gain_db, b->q, sample_rate);
                break;
            case BAND_MID_PEAK:
                biquad_set_peak     (&b->filters[ch], b->freq, b->gain_db, b->q, sample_rate);
                break;
            case BAND_HIGH_SHELF:
                biquad_set_highshelf(&b->filters[ch], b->freq, b->gain_db, b->q, sample_rate);
                break;
        }
    }
}

float eq_process_sample(TrackEQ* eq, float sample, int channel) {
    if (!eq->enabled) return sample;
    float out = sample;
    for (int b = 0; b < 3; b++) {
        if (eq->bands[b].enabled) {
            out = biquad_process(&eq->bands[b].filters[channel], out);
        }
    }
    return out;
}
