#include "compressor.h"
#include "plugin_ids.h"
#include <math.h>

/* Convert a time constant in milliseconds to a per-sample exponential coeff.
   coeff → 0 means "never move", coeff → 1 means "jump instantly". */
static float ms_coeff(float ms, float sr) {
    if (ms <= 0.f) return 1.f;
    return 1.f - expf(-1.f / (ms * sr * 0.001f));
}

void compressor_init(Compressor* c, float sr) {
    c->enabled     = 1;
    c->amount      = 0.f;
    c->env_sq      = 0.f;
    c->gr_lin      = 1.f;
    c->gr_avg_db   = 0.f;  /* 0 dB = no gain reduction yet */
    c->sample_rate = sr;

    /* Fixed optical time constants — not user-adjustable. */
    c->att_env  = ms_coeff(10.f,   sr);  /* RMS detector attack  10 ms  */
    c->rel_env  = ms_coeff(150.f,  sr);  /* RMS detector release 150 ms */
    c->att_gr   = ms_coeff(15.f,   sr);  /* gain elem attack     15 ms  */
    c->rel_gr   = ms_coeff(500.f,  sr);  /* gain elem release    500 ms */
    c->agc_coeff = ms_coeff(2000.f, sr); /* AGC averaging ~2 s          */
}

void compressor_set_param(Compressor* c, int param_id, float value) {
    switch (param_id) {
        case COMP_PARAM_ENABLED:
            c->enabled = (value >= 0.5f);
            break;
        case COMP_PARAM_AMOUNT:
            c->amount = value;
            break;
    }
}

void compressor_process(Compressor* c,
                        float in_L, float in_R,
                        float* out_L, float* out_R) {
    if (!c->enabled || c->amount < 0.001f) {
        *out_L = in_L;
        *out_R = in_R;
        return;
    }

    float amt = c->amount * 0.01f;  /* 0-1 */

    /* ── Level detection (linked stereo) ───────────────────────────────────
     * Use the louder of the two channels (max-of-squares).
     * Smooth with separate attack/release ballistics → simulates the
     * electroluminescent panel charging/discharging in the LA-2A.         */
    float sq = in_L * in_L;
    float sqR = in_R * in_R;
    if (sqR > sq) sq = sqR;

    float coeff = (sq > c->env_sq) ? c->att_env : c->rel_env;
    c->env_sq += coeff * (sq - c->env_sq);
    float level_rms = sqrtf(c->env_sq < 0.f ? 0.f : c->env_sq);

    /* ── Threshold (derived from amount) ───────────────────────────────────
     * At amount=0:   threshold ≈ -3 dBFS  (barely touches loud signals)
     * At amount=100: threshold ≈ -36 dBFS (heavy limiting)                */
    float thresh_db  = -3.f - 33.f * amt;
    float thresh_lin = powf(10.f, thresh_db * 0.05f);  /* /20 in log domain */

    /* ── Optical gain reduction curve ──────────────────────────────────────
     * The optical element gives a soft, progressive ratio:
     *   - Gentle below threshold, increasing above it.
     *   - Models the non-linear V_out = V_in / (1 + k·V_in) character of
     *     a CdS photocell driven by an EL panel.
     *
     * We use a smooth soft-knee formulation so there is no hard boundary. */
    float target_gr = 1.f;
    if (level_rms > 1e-6f) {
        float over = level_rms / thresh_lin;  /* > 1 when above threshold */
        if (over > 1.f) {
            /* Effective ratio grows with over-threshold amount and with amt.
             * ratio_k = 1..8 scales the compression character.              */
            float ratio_k = 1.f + 7.f * amt;   /* up to 8:1 at full knob  */
            /* Gain reduction in linear: optical attenuation formula.
             * gr = 1 / (1 + (over-1) * ratio_k) — smooth, never zero.     */
            float over_above = over - 1.f;
            target_gr = 1.f / (1.f + over_above * ratio_k);
        }
        /* Soft approach below threshold (no hard knee needed — already smooth). */
    }

    /* ── Gain element smoothing ─────────────────────────────────────────────
     * Attack is fast (gain reduction applied quickly — optical responds to
     * transients).  Release is slow and "lazy" — the characteristic LA-2A
     * pumping/breath is avoided because the time constants here are long.  */
    float gr_coeff = (target_gr < c->gr_lin) ? c->att_gr : c->rel_gr;
    c->gr_lin += gr_coeff * (target_gr - c->gr_lin);

    /* ── Automatic gain compensation (AGC) — dB-domain averaging ──────────
     * Convert gr_lin to dB before smoothing.  Linear averaging of small
     * multipliers (e.g. 0.01 = −40 dB) barely moves a linear average away
     * from 1.0, producing far too little makeup at high compression amounts.
     * Averaging in dB measures what the compressor is actually doing in
     * perceptual terms, so makeup exactly tracks the average GR regardless
     * of how deep the compression goes.
     *
     * gr_avg_db ≤ 0 (negative = gain reduction).
     * Makeup    = 10^(-gr_avg_db / 20) — the positive dB inverse.
     * Clamped so makeup never exceeds +18 dB (+18 → gr_avg_db ≥ −18).    */
    float gr_db_now = (c->gr_lin > 1e-6f)
                    ? 20.f * log10f(c->gr_lin)
                    : -120.f;
    c->gr_avg_db += c->agc_coeff * (gr_db_now - c->gr_avg_db);
    float avg_db_clamped = c->gr_avg_db < -18.f ? -18.f
                         : c->gr_avg_db >   0.f ?   0.f
                         : c->gr_avg_db;
    float makeup = powf(10.f, -avg_db_clamped * 0.05f);  /* /20 → linear */

    float gain = c->gr_lin * makeup;
    *out_L = in_L * gain;
    *out_R = in_R * gain;
}

void compressor_reset(Compressor* c) {
    c->env_sq = 0.f;
    c->gr_lin    = 1.f;
    c->gr_avg_db = 0.f;
}
