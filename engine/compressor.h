#ifndef COMPRESSOR_H
#define COMPRESSOR_H

/* ── LA-2A-style optical compressor ─────────────────────────────────────────
 *
 * A single "amount" knob (0-100) drives the whole character:
 *   0   → transparent / bypass
 *   50  → moderate compression, ~3:1 ratio
 *   100 → heavy, limiting compression, ~8:1 ratio
 *
 * Time constants are fixed to model the optical element:
 *   RMS detector:  attack ~10 ms, release ~150 ms
 *   Gain element:  attack ~15 ms, release ~500 ms (program-dependent)
 *
 * Linked-stereo: a single detector sees max(|L|, |R|) so the stereo image
 * is preserved — both channels get exactly the same gain reduction.
 * Implicit makeup gain rises with amount so 0 dB unity gain is roughly
 * maintained at any knob position.
 */

typedef struct {
    int   enabled;
    float amount;       /* 0 – 100 */

    /* Level detector state (squared RMS) */
    float env_sq;       /* smoothed squared envelope */
    float att_env;      /* detector attack  coeff (per sample) */
    float rel_env;      /* detector release coeff (per sample) */

    /* Gain element state */
    float gr_lin;       /* current gain reduction multiplier (0-1) */
    float att_gr;       /* gain reduction attack  coeff */
    float rel_gr;       /* gain reduction release coeff */

    /* Automatic gain compensation (AGC) — averaged in dB domain */
    float gr_avg_db;    /* long-term average of gain reduction in dB (≤ 0) */
    float agc_coeff;    /* very slow smoothing coeff (~2 s)                */

    float sample_rate;
} Compressor;

void compressor_init(Compressor* c, float sample_rate);
void compressor_set_param(Compressor* c, int param_id, float value);

/* Process one stereo frame (linked detector, shared gain).
   in_L / in_R  → raw samples after EQ
   out_L / out_R → compressed samples (gain applied, makeup included)    */
void compressor_process(Compressor* c,
                        float in_L, float in_R,
                        float* out_L, float* out_R);

/* Reset envelope state (call on seek to avoid pops). */
void compressor_reset(Compressor* c);

#endif
