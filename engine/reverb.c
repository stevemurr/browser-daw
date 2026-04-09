#include "reverb.h"
#include "plugin_ids.h"
#include <math.h>
#include <string.h>

/* ── Preset table ──────────────────────────────────────────────────────────── */

static void apply_preset(Reverb* r, int p) {
    static const float fb[3]   = { 0.80f, 0.91f, 0.97f };
    static const float damp[3] = { 0.50f, 0.30f, 0.10f };
    r->feedback = fb[p];
    r->damping  = damp[p];
}

/* ── Comb filter ───────────────────────────────────────────────────────────── */

static float comb_process(CombFilter* c, float input, float feedback, float damping) {
    float output = c->buf[c->pos];
    c->filter_state = output * (1.f - damping) + c->filter_state * damping;
    c->buf[c->pos] = input + c->filter_state * feedback;
    c->pos = (c->pos + 1 >= c->size) ? 0 : c->pos + 1;
    return output;
}

/* ── Allpass filter ────────────────────────────────────────────────────────── */

static float allpass_process(AllpassFilter* a, float input) {
    float buf_out  = a->buf[a->pos];
    float output   = -input + buf_out;
    a->buf[a->pos] = input + buf_out * 0.5f;
    a->pos = (a->pos + 1 >= a->size) ? 0 : a->pos + 1;
    return output;
}

/* ── Init ──────────────────────────────────────────────────────────────────── */

void reverb_init(Reverb* r, float sample_rate) {
    (void)sample_rate; /* delays are fixed for 44100 Hz */
    memset(r, 0, sizeof(Reverb));

    /* Set comb delay sizes — L channel */
    static const int comb_sizes[REV_COMB_COUNT] = {
        REV_COMB_L_0, REV_COMB_L_1, REV_COMB_L_2, REV_COMB_L_3,
        REV_COMB_L_4, REV_COMB_L_5, REV_COMB_L_6, REV_COMB_L_7
    };
    for (int i = 0; i < REV_COMB_COUNT; i++) {
        r->combs_L[i].size = comb_sizes[i];
        r->combs_R[i].size = comb_sizes[i] + REV_COMB_SPREAD;
    }

    /* Allpass delay sizes — same for L and R */
    static const int ap_sizes[REV_ALLPASS_COUNT] = {
        REV_AP_L_0, REV_AP_L_1, REV_AP_L_2, REV_AP_L_3
    };
    for (int i = 0; i < REV_ALLPASS_COUNT; i++) {
        r->aps_L[i].size = ap_sizes[i];
        r->aps_R[i].size = ap_sizes[i];
    }

    r->enabled = 1;
    r->preset  = 0.f;
    r->mix     = 0.f;
    apply_preset(r, 0);
}

/* ── Reset ─────────────────────────────────────────────────────────────────── */

void reverb_reset(Reverb* r) {
    for (int i = 0; i < REV_COMB_COUNT; i++) {
        memset(r->combs_L[i].buf, 0, sizeof(r->combs_L[i].buf));
        r->combs_L[i].pos          = 0;
        r->combs_L[i].filter_state = 0.f;
        memset(r->combs_R[i].buf, 0, sizeof(r->combs_R[i].buf));
        r->combs_R[i].pos          = 0;
        r->combs_R[i].filter_state = 0.f;
    }
    for (int i = 0; i < REV_ALLPASS_COUNT; i++) {
        memset(r->aps_L[i].buf, 0, sizeof(r->aps_L[i].buf));
        r->aps_L[i].pos = 0;
        memset(r->aps_R[i].buf, 0, sizeof(r->aps_R[i].buf));
        r->aps_R[i].pos = 0;
    }
    apply_preset(r, (int)r->preset);
}

/* ── Set param ─────────────────────────────────────────────────────────────── */

void reverb_set_param(Reverb* r, int param_id, float value) {
    switch (param_id) {
        case REV_PARAM_ENABLED:
            r->enabled = (value >= 0.5f);
            break;
        case REV_PARAM_PRESET: {
            int p = (int)value;
            if (p < 0) p = 0;
            if (p > 2) p = 2;
            r->preset = (float)p;
            apply_preset(r, p);
            reverb_reset(r);
            break;
        }
        case REV_PARAM_MIX:
            r->mix = value * 0.01f;
            break;
    }
}

/* ── Process ───────────────────────────────────────────────────────────────── */

void reverb_process(Reverb* r, float in_L, float in_R,
                    float* out_L, float* out_R) {
    if (!r->enabled || r->mix < 0.0001f) {
        *out_L = in_L; *out_R = in_R; return;
    }

    int p = (int)r->preset;
    /* Input gain scaled down to prevent overload */
    float input = (in_L + in_R) * 0.015f;

    float wet_L = 0.f, wet_R = 0.f;
    for (int i = 0; i < REV_COMB_COUNT; i++) {
        wet_L += comb_process(&r->combs_L[i], input, r->feedback, r->damping);
        wet_R += comb_process(&r->combs_R[i], input, r->feedback, r->damping);
    }

    /* Non-linear preset: soft saturation on comb sum */
    if (p == 2) {
        wet_L = tanhf(wet_L * 1.2f) / 1.2f;
        wet_R = tanhf(wet_R * 1.2f) / 1.2f;
    }

    /* Allpass chain */
    for (int i = 0; i < REV_ALLPASS_COUNT; i++) {
        wet_L = allpass_process(&r->aps_L[i], wet_L);
        wet_R = allpass_process(&r->aps_R[i], wet_R);
    }

    *out_L = in_L * (1.f - r->mix) + wet_L * r->mix;
    *out_R = in_R * (1.f - r->mix) + wet_R * r->mix;
}
