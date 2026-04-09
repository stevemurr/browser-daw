#include "chorus.h"
#include "plugin_ids.h"
#include <math.h>
#include <string.h>

/*
 * Dimension D-style chorus — quadrature four-tap architecture.
 *
 * The Roland Dimension D (SDD-320) creates its signature spatial effect through
 * four modulated delay lines with LFO phases 90° apart.  L and R outputs read
 * from different tap pairs, so the two channels are always in different states
 * of modulation.  This produces genuine stereo width even from mono sources
 * without the obvious "wobble" of single-LFO chorus.
 *
 * Architecture:
 *   Four virtual taps, derived from two anti-phase pairs:
 *     Pair A (feeds L):  delay ± swing·sin(θ)    phases 0° and 180°
 *     Pair B (feeds R):  delay ± swing·cos(θ)    phases 90° and 270°
 *
 *   Averaging the anti-phase pair within each output keeps the net delay
 *   centred (no pitch drift on the direct signal) while the comb-filter
 *   colouring still varies — and it varies 90° out of phase between L and R.
 *
 *   The two pairs also use slightly different centre delays (15 ms and 16.2 ms)
 *   to break the symmetry between channels and add a subtle BBD-like timbre.
 *
 * Parameters (unchanged IDs for backwards-compat):
 *   rate  — LFO Hz  (0.1–5.0)   sweet spot for Dim-D character: 0.2–0.8 Hz
 *   depth — 0–100   maps to 0–3 ms swing (vs 10 ms in the old single-tap)
 *   mix   — 0–100 % wet/dry blend
 */

/* Fast interpolated read from circular buffer (buf size must be power-of-two). */
static inline float read_tap(const float* buf, int write_pos, float delay_f) {
    int   d    = (int)delay_f;
    float frac = delay_f - (float)d;
    int   r0   = (write_pos - d     + CHORUS_BUF_SIZE) & (CHORUS_BUF_SIZE - 1);
    int   r1   = (write_pos - d - 1 + CHORUS_BUF_SIZE) & (CHORUS_BUF_SIZE - 1);
    return buf[r0] * (1.f - frac) + buf[r1] * frac;
}

void chorus_init(Chorus* c, float sample_rate) {
    c->enabled     = 1;
    /* Defaults = size 50: depth 0.525 → ~1.6 ms swing, rate 0.35 Hz */
    c->rate        = 0.35f;
    c->depth       = 0.525f;
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
            c->depth = value * 0.01f;   /* 0–100 → 0.0–1.0 */
            break;
        case CHORUS_PARAM_MIX:
            c->mix = value * 0.01f;
            break;
        case CHORUS_PARAM_SIZE: {
            /* size 0–100 simultaneously controls modulation swing and LFO rate.
               depth 0.05–1.0  →  swing 0.15–3.0 ms   (via chorus_process mapping)
               rate  0.50–0.20 Hz  (larger = slower: big spaces feel more languid) */
            float t    = value * 0.01f;               /* 0.0 – 1.0 */
            c->depth   = 0.05f + t * 0.95f;           /* 0.05 → 1.0 */
            c->rate    = 0.50f - t * 0.30f;           /* 0.50 → 0.20 Hz */
            c->lfo_inc = 6.28318530f * c->rate / c->sample_rate;
            break;
        }
    }
}

void chorus_process(Chorus* c, float in_L, float in_R,
                    float* out_L, float* out_R) {
    if (!c->enabled) {
        *out_L = in_L;
        *out_R = in_R;
        return;
    }

    float sr = c->sample_rate;

    /* Centre delays for the two tap pairs.
       The 1.2 ms offset between pairs gives each channel a slightly different
       base timbre, mimicking the unit-to-unit variation of BBD circuits. */
    float center_A = 15.0f * sr * 0.001f;   /* pair A → L output */
    float center_B = 16.2f * sr * 0.001f;   /* pair B → R output */

    /* Swing: depth maps to 0–3 ms peak deviation.
       This is deliberately much shallower than standard chorus (≤3 ms vs ≤10 ms)
       — the Dimension D's subtlety comes from gentle, quadrature modulation. */
    float swing = c->depth * 3.0f * sr * 0.001f;

    /* Quadrature LFO: sin for pair A, cos for pair B (90° offset). */
    float s = sinf(c->lfo_phase);
    float k = cosf(c->lfo_phase);

    /* Pair A (L): average of taps at +swing·sin and −swing·sin.
       Pair B (R): average of taps at +swing·cos and −swing·cos.
       Averaging anti-phase taps removes net pitch drift while preserving the
       comb-filter colouring. The 90° offset between pairs keeps L and R in
       perpetually different modulation states → continuous stereo rotation. */
    float wet_L = (read_tap(c->buf_L, c->write_pos, center_A + swing * s)
                 + read_tap(c->buf_L, c->write_pos, center_A - swing * s)) * 0.5f;

    float wet_R = (read_tap(c->buf_R, c->write_pos, center_B + swing * k)
                 + read_tap(c->buf_R, c->write_pos, center_B - swing * k)) * 0.5f;

    /* Write input after reading so the current sample is never part of itself. */
    c->buf_L[c->write_pos] = in_L;
    c->buf_R[c->write_pos] = in_R;
    c->write_pos = (c->write_pos + 1) & (CHORUS_BUF_SIZE - 1);

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
