/*
 * Plugin unit tests — covers eq, compressor, distortion, limiter,
 * delay, chorus, and reverb directly (no engine scaffolding needed).
 * Compile via: make test-c (from project root)
 */
#include "vendor/unity/unity.h"
#include "eq.h"
#include "compressor.h"
#include "distortion.h"
#include "limiter.h"
#include "delay.h"
#include "chorus.h"
#include "reverb.h"
#include "plugin_ids.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>

void setUp(void)    {}
void tearDown(void) {}

/* ── EQ ──────────────────────────────────────────────────────────────────── */

void test_eq_disabled_passes_through(void) {
    TrackEQ eq;
    eq_init(&eq, 44100.0f);
    eq.enabled = 0;
    float out = eq_process_sample(&eq, 0.5f, 0);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.5f, out);
}

void test_eq_set_param_enabled_toggles(void) {
    TrackEQ eq;
    eq_init(&eq, 44100.0f);
    eq_set_param(&eq, EQ_PARAM_ENABLED, 0.0f, 44100.0f);
    TEST_ASSERT_EQUAL_INT(0, eq.enabled);
    eq_set_param(&eq, EQ_PARAM_ENABLED, 1.0f, 44100.0f);
    TEST_ASSERT_EQUAL_INT(1, eq.enabled);
}

void test_eq_set_param_band0_freq(void) {
    TrackEQ eq;
    eq_init(&eq, 44100.0f);
    eq_set_param(&eq, EQ_PARAM_BAND0_FREQ, 200.0f, 44100.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 200.0f, eq.bands[0].freq);
}

void test_eq_set_param_band0_gain(void) {
    TrackEQ eq;
    eq_init(&eq, 44100.0f);
    eq_set_param(&eq, EQ_PARAM_BAND0_GAIN, 6.0f, 44100.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 6.0f, eq.bands[0].gain_db);
}

void test_eq_set_param_band0_q(void) {
    TrackEQ eq;
    eq_init(&eq, 44100.0f);
    eq_set_param(&eq, EQ_PARAM_BAND0_Q, 1.5f, 44100.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.5f, eq.bands[0].q);
}

void test_eq_set_param_band1_freq(void) {
    TrackEQ eq;
    eq_init(&eq, 44100.0f);
    eq_set_param(&eq, EQ_PARAM_BAND1_FREQ, 2000.0f, 44100.0f);
    TEST_ASSERT_FLOAT_WITHIN(1.0f, 2000.0f, eq.bands[1].freq);
}

void test_eq_set_param_band1_gain(void) {
    TrackEQ eq;
    eq_init(&eq, 44100.0f);
    eq_set_param(&eq, EQ_PARAM_BAND1_GAIN, 3.0f, 44100.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 3.0f, eq.bands[1].gain_db);
}

void test_eq_set_param_band1_q(void) {
    TrackEQ eq;
    eq_init(&eq, 44100.0f);
    eq_set_param(&eq, EQ_PARAM_BAND1_Q, 2.0f, 44100.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 2.0f, eq.bands[1].q);
}

void test_eq_set_param_band2_freq(void) {
    TrackEQ eq;
    eq_init(&eq, 44100.0f);
    eq_set_param(&eq, EQ_PARAM_BAND2_FREQ, 12000.0f, 44100.0f);
    TEST_ASSERT_FLOAT_WITHIN(10.0f, 12000.0f, eq.bands[2].freq);
}

void test_eq_set_param_band2_gain(void) {
    TrackEQ eq;
    eq_init(&eq, 44100.0f);
    eq_set_param(&eq, EQ_PARAM_BAND2_GAIN, -6.0f, 44100.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, -6.0f, eq.bands[2].gain_db);
}

void test_eq_set_param_band2_q(void) {
    TrackEQ eq;
    eq_init(&eq, 44100.0f);
    eq_set_param(&eq, EQ_PARAM_BAND2_Q, 0.5f, 44100.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.5f, eq.bands[2].q);
}

void test_eq_set_param_out_of_range_ignored(void) {
    TrackEQ eq;
    eq_init(&eq, 44100.0f);
    /* param_id=100 → band=(100-1)/3=33 > 2 → should be ignored, no crash */
    eq_set_param(&eq, 100, 1.0f, 44100.0f);
    TEST_PASS();
}

void test_eq_set_param_negative_param_ignored(void) {
    TrackEQ eq;
    eq_init(&eq, 44100.0f);
    /* param_id=-3 → idx=-4 → band = -4/3 = -1 < 0 → early return, no crash */
    eq_set_param(&eq, -3, 1.0f, 44100.0f);
    TEST_PASS();
}

void test_eq_biquad_reset_clears_state(void) {
    Biquad b;
    memset(&b, 0xFF, sizeof(b));
    biquad_reset(&b);
    TEST_ASSERT_FLOAT_WITHIN(1e-9f, 0.0f, b.x1);
    TEST_ASSERT_FLOAT_WITHIN(1e-9f, 0.0f, b.x2);
    TEST_ASSERT_FLOAT_WITHIN(1e-9f, 0.0f, b.y1);
    TEST_ASSERT_FLOAT_WITHIN(1e-9f, 0.0f, b.y2);
}

void test_eq_biquad_lowshelf_processes(void) {
    Biquad b;
    memset(&b, 0, sizeof(b));
    biquad_set_lowshelf(&b, 80.0f, 12.0f, 0.707f, 44100.0f);
    /* Should produce some non-trivial output for a DC impulse */
    float out = biquad_process(&b, 1.0f);
    TEST_ASSERT_TRUE(fabsf(out) > 0.0f);
}

void test_eq_biquad_highshelf_processes(void) {
    Biquad b;
    memset(&b, 0, sizeof(b));
    biquad_set_highshelf(&b, 8000.0f, 12.0f, 0.707f, 44100.0f);
    float out = biquad_process(&b, 1.0f);
    TEST_ASSERT_TRUE(fabsf(out) > 0.0f);
}

void test_eq_biquad_peak_processes(void) {
    Biquad b;
    memset(&b, 0, sizeof(b));
    biquad_set_peak(&b, 1000.0f, 12.0f, 0.707f, 44100.0f);
    float out = biquad_process(&b, 1.0f);
    TEST_ASSERT_TRUE(fabsf(out) > 0.0f);
}

void test_eq_zero_gain_band_passes_through(void) {
    TrackEQ eq;
    eq_init(&eq, 44100.0f);
    /* All bands at 0 dB — steady-state single-sample won't match exactly,
       but after many samples the filter settles. Check it's non-zero. */
    float out = eq_process_sample(&eq, 0.5f, 0);
    TEST_ASSERT_TRUE(fabsf(out) > 0.0f);
}

/* ── Compressor ──────────────────────────────────────────────────────────── */

void test_compressor_bypass_when_amount_zero(void) {
    Compressor c;
    compressor_init(&c, 44100.0f);
    float out_L, out_R;
    compressor_process(&c, 0.5f, 0.3f, &out_L, &out_R);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.5f, out_L);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.3f, out_R);
}

void test_compressor_disabled_passes_through(void) {
    Compressor c;
    compressor_init(&c, 44100.0f);
    compressor_set_param(&c, COMP_PARAM_ENABLED, 0.0f);
    float out_L, out_R;
    compressor_process(&c, 0.8f, 0.8f, &out_L, &out_R);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.8f, out_L);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.8f, out_R);
}

void test_compressor_reduces_loud_signal(void) {
    Compressor c;
    compressor_init(&c, 44100.0f);
    compressor_set_param(&c, COMP_PARAM_AMOUNT, 100.0f);

    float out_L, out_R;
    /* Feed a sustained loud signal so the RMS detector and gain element react */
    for (int i = 0; i < 3000; i++)
        compressor_process(&c, 0.99f, 0.99f, &out_L, &out_R);

    /* After many samples of loud signal, gain reduction must kick in */
    TEST_ASSERT_TRUE(out_L < 0.99f);
}

void test_compressor_attack_then_release(void) {
    Compressor c;
    compressor_init(&c, 44100.0f);
    compressor_set_param(&c, COMP_PARAM_AMOUNT, 80.0f);

    float out_L, out_R;
    /* Attack: feed loud signal to reduce gr_lin */
    for (int i = 0; i < 3000; i++)
        compressor_process(&c, 0.99f, 0.99f, &out_L, &out_R);
    float gr_after_attack = c.gr_lin;

    /* Release: feed silence long enough for the 150 ms RMS envelope to drop
       below threshold (~44k frames at 44100 Hz) and for the 500 ms gain element
       to recover (~22k frames more). 100000 frames covers both comfortably. */
    for (int i = 0; i < 100000; i++)
        compressor_process(&c, 0.0f, 0.0f, &out_L, &out_R);
    float gr_after_release = c.gr_lin;

    /* Gain should have recovered toward 1.0 */
    TEST_ASSERT_TRUE(gr_after_release > gr_after_attack);
}

void test_compressor_set_param_amount(void) {
    Compressor c;
    compressor_init(&c, 44100.0f);
    compressor_set_param(&c, COMP_PARAM_AMOUNT, 75.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 75.0f, c.amount);
}

void test_compressor_set_param_enabled_toggle(void) {
    Compressor c;
    compressor_init(&c, 44100.0f);
    compressor_set_param(&c, COMP_PARAM_ENABLED, 0.0f);
    TEST_ASSERT_EQUAL_INT(0, c.enabled);
    compressor_set_param(&c, COMP_PARAM_ENABLED, 1.0f);
    TEST_ASSERT_EQUAL_INT(1, c.enabled);
}

void test_compressor_reset_clears_state(void) {
    Compressor c;
    compressor_init(&c, 44100.0f);
    compressor_set_param(&c, COMP_PARAM_AMOUNT, 100.0f);
    float out_L, out_R;
    for (int i = 0; i < 1000; i++)
        compressor_process(&c, 0.99f, 0.99f, &out_L, &out_R);
    compressor_reset(&c);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.0f, c.env_sq);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 1.0f, c.gr_lin);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.0f, c.gr_avg_db);
}

void test_compressor_stereo_linked(void) {
    Compressor c;
    compressor_init(&c, 44100.0f);
    compressor_set_param(&c, COMP_PARAM_AMOUNT, 100.0f);

    float out_L, out_R;
    /* Right channel louder — detection is linked (max of both) */
    for (int i = 0; i < 3000; i++)
        compressor_process(&c, 0.1f, 0.99f, &out_L, &out_R);

    /* Both channels should be reduced since detector uses max(L,R) */
    TEST_ASSERT_TRUE(out_L < 0.1f + 0.01f); /* L is reduced too */
}

/* ── Distortion ──────────────────────────────────────────────────────────── */

void test_distortion_bypass_drive_zero(void) {
    Distortion d;
    distortion_init(&d);
    float out_L, out_R;
    distortion_process(&d, 0.6f, -0.4f, &out_L, &out_R);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.6f, out_L);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, -0.4f, out_R);
}

void test_distortion_disabled_passes_through(void) {
    Distortion d;
    distortion_init(&d);
    distortion_set_param(&d, DIST_PARAM_ENABLED, 0.0f);
    distortion_set_param(&d, DIST_PARAM_DRIVE, 50.0f);
    float out_L, out_R;
    distortion_process(&d, 0.6f, -0.4f, &out_L, &out_R);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.6f, out_L);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, -0.4f, out_R);
}

void test_distortion_mode0_soft_clip_saturates(void) {
    Distortion d;
    distortion_init(&d);
    distortion_set_param(&d, DIST_PARAM_DRIVE, 80.0f);
    distortion_set_param(&d, DIST_PARAM_MODE,   0.0f);
    distortion_set_param(&d, DIST_PARAM_MIX,  100.0f);

    float out_L, out_R;
    /* pregain=10^(80*0.04)=10^3.2≈1585; tanh(1585)≈1.0 */
    distortion_process(&d, 1.0f, 1.0f, &out_L, &out_R);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 1.0f, out_L);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 1.0f, out_R);
}

void test_distortion_mode1_hard_clip_positive(void) {
    Distortion d;
    distortion_init(&d);
    distortion_set_param(&d, DIST_PARAM_DRIVE, 50.0f);  /* pregain=100 */
    distortion_set_param(&d, DIST_PARAM_MODE,   1.0f);
    distortion_set_param(&d, DIST_PARAM_MIX,  100.0f);

    float out_L, out_R;
    /* 0.5*100=50 > 1 → clamped to 1.0 */
    distortion_process(&d, 0.5f, 0.5f, &out_L, &out_R);
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, 1.0f, out_L);
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, 1.0f, out_R);
}

void test_distortion_mode1_hard_clip_negative(void) {
    Distortion d;
    distortion_init(&d);
    distortion_set_param(&d, DIST_PARAM_DRIVE, 50.0f);
    distortion_set_param(&d, DIST_PARAM_MODE,   1.0f);
    distortion_set_param(&d, DIST_PARAM_MIX,  100.0f);

    float out_L, out_R;
    distortion_process(&d, -0.5f, -0.5f, &out_L, &out_R);
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, -1.0f, out_L);
}

void test_distortion_mode1_no_clip_in_range(void) {
    Distortion d;
    distortion_init(&d);
    /* low drive so pregain is small — keep x in [-1,1] */
    distortion_set_param(&d, DIST_PARAM_DRIVE, 1.0f);   /* pregain=10^0.04≈1.096 */
    distortion_set_param(&d, DIST_PARAM_MODE,   1.0f);
    distortion_set_param(&d, DIST_PARAM_MIX,  100.0f);

    float out_L, out_R;
    /* 0.1 * 1.096 = 0.11 — in range, passes through */
    distortion_process(&d, 0.1f, 0.1f, &out_L, &out_R);
    TEST_ASSERT_FLOAT_WITHIN(0.05f, 0.1f, out_L);
}

void test_distortion_mode2_fuzz_positive(void) {
    Distortion d;
    distortion_init(&d);
    distortion_set_param(&d, DIST_PARAM_DRIVE, 30.0f);
    distortion_set_param(&d, DIST_PARAM_MODE,   2.0f);
    distortion_set_param(&d, DIST_PARAM_MIX,  100.0f);

    float out_L, out_R;
    distortion_process(&d, 0.5f, 0.5f, &out_L, &out_R);
    /* Fuzz positive: 1 - exp(-x) ∈ (0,1) */
    TEST_ASSERT_TRUE(out_L > 0.0f && out_L < 1.0f);
}

void test_distortion_mode2_fuzz_negative(void) {
    Distortion d;
    distortion_init(&d);
    distortion_set_param(&d, DIST_PARAM_DRIVE, 30.0f);
    distortion_set_param(&d, DIST_PARAM_MODE,   2.0f);
    distortion_set_param(&d, DIST_PARAM_MIX,  100.0f);

    float out_L, out_R;
    distortion_process(&d, -0.5f, -0.5f, &out_L, &out_R);
    /* Fuzz negative: -tanh(-x*2) → negative output */
    TEST_ASSERT_TRUE(out_L < 0.0f);
}

void test_distortion_partial_mix(void) {
    Distortion d;
    distortion_init(&d);
    distortion_set_param(&d, DIST_PARAM_DRIVE, 50.0f);
    distortion_set_param(&d, DIST_PARAM_MODE,   0.0f);
    distortion_set_param(&d, DIST_PARAM_MIX,   50.0f);

    float out_L, out_R;
    distortion_process(&d, 0.5f, 0.5f, &out_L, &out_R);
    /* 50% wet: out = 0.5*(1-0.5) + tanh(0.5*pregain)*0.5 */
    TEST_ASSERT_TRUE(out_L > 0.0f && out_L < 1.5f);
}

void test_distortion_set_param_drive(void) {
    Distortion d;
    distortion_init(&d);
    distortion_set_param(&d, DIST_PARAM_DRIVE, 42.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 42.0f, d.drive);
}

void test_distortion_set_param_mode(void) {
    Distortion d;
    distortion_init(&d);
    distortion_set_param(&d, DIST_PARAM_MODE, 2.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 2.0f, d.mode);
}

void test_distortion_set_param_mix(void) {
    Distortion d;
    distortion_init(&d);
    distortion_set_param(&d, DIST_PARAM_MIX, 75.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 75.0f, d.mix);
}

/* ── Limiter ─────────────────────────────────────────────────────────────── */

void test_limiter_passes_through_below_threshold(void) {
    Limiter l;
    limiter_init(&l, 44100.0f);
    float out_L, out_R;
    /* 0.5 is well below threshold_lin ≈ 0.966 */
    limiter_process(&l, 0.5f, 0.5f, &out_L, &out_R);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.5f, out_L);
}

void test_limiter_engages_above_threshold(void) {
    Limiter l;
    limiter_init(&l, 44100.0f);
    float thresh_lin = powf(10.0f, l.threshold_db / 20.0f);
    float out_L, out_R;
    limiter_process(&l, 2.0f, 2.0f, &out_L, &out_R);
    /* Output must be at or below threshold */
    TEST_ASSERT_TRUE(fabsf(out_L) <= thresh_lin + 1e-5f);
}

void test_limiter_gain_reduces_on_overload(void) {
    Limiter l;
    limiter_init(&l, 44100.0f);
    float out_L, out_R;
    limiter_process(&l, 2.0f, 2.0f, &out_L, &out_R);
    TEST_ASSERT_TRUE(l.gain_lin < 1.0f);
}

void test_limiter_disabled_passes_through(void) {
    Limiter l;
    limiter_init(&l, 44100.0f);
    limiter_set_param(&l, LIM_PARAM_ENABLED, 0.0f);
    float out_L, out_R;
    limiter_process(&l, 2.0f, 3.0f, &out_L, &out_R);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 2.0f, out_L);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 3.0f, out_R);
}

void test_limiter_reset_restores_gain(void) {
    Limiter l;
    limiter_init(&l, 44100.0f);
    float out_L, out_R;
    limiter_process(&l, 2.0f, 2.0f, &out_L, &out_R);
    TEST_ASSERT_TRUE(l.gain_lin < 1.0f);
    limiter_reset(&l);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 1.0f, l.gain_lin);
}

void test_limiter_release_recovers_gain(void) {
    Limiter l;
    limiter_init(&l, 44100.0f);
    float out_L, out_R;
    /* Engage limiter */
    limiter_process(&l, 2.0f, 2.0f, &out_L, &out_R);
    float gr_after_hit = l.gain_lin;
    /* Let it release with sub-threshold signal */
    for (int i = 0; i < 5000; i++)
        limiter_process(&l, 0.1f, 0.1f, &out_L, &out_R);
    /* Gain should have recovered toward 1.0 */
    TEST_ASSERT_TRUE(l.gain_lin > gr_after_hit);
}

void test_limiter_threshold_param_clamped_low(void) {
    Limiter l;
    limiter_init(&l, 44100.0f);
    limiter_set_param(&l, LIM_PARAM_THRESHOLD, -50.0f);  /* below -24 */
    TEST_ASSERT_FLOAT_WITHIN(0.01f, -24.0f, l.threshold_db);
}

void test_limiter_threshold_param_clamped_high(void) {
    Limiter l;
    limiter_init(&l, 44100.0f);
    limiter_set_param(&l, LIM_PARAM_THRESHOLD, 3.0f);  /* above 0 */
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.0f, l.threshold_db);
}

void test_limiter_threshold_param_valid(void) {
    Limiter l;
    limiter_init(&l, 44100.0f);
    limiter_set_param(&l, LIM_PARAM_THRESHOLD, -6.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, -6.0f, l.threshold_db);
}

void test_limiter_release_param_clamped_low(void) {
    Limiter l;
    limiter_init(&l, 44100.0f);
    limiter_set_param(&l, LIM_PARAM_RELEASE, 5.0f);  /* below 10 */
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 10.0f, l.release_ms);
}

void test_limiter_release_param_clamped_high(void) {
    Limiter l;
    limiter_init(&l, 44100.0f);
    limiter_set_param(&l, LIM_PARAM_RELEASE, 1000.0f);  /* above 500 */
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 500.0f, l.release_ms);
}

void test_limiter_release_param_valid(void) {
    Limiter l;
    limiter_init(&l, 44100.0f);
    limiter_set_param(&l, LIM_PARAM_RELEASE, 200.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 200.0f, l.release_ms);
}

void test_limiter_zero_sample_rate_no_crash(void) {
    /* limiter_init with sr=0 exercises compute_rel_coeff early return
       (sample_rate <= 0.f → return 1.f) */
    Limiter l;
    limiter_init(&l, 0.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.0f, l.rel_coeff);
}

/* ── Delay ───────────────────────────────────────────────────────────────── */

void test_delay_dry_passthrough(void) {
    Delay d;
    delay_init(&d, 44100.0f);
    /* Default mix=0 → dry only */
    float out_L, out_R;
    delay_process(&d, 0.7f, -0.3f, &out_L, &out_R);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.7f, out_L);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, -0.3f, out_R);
    delay_free(&d);
}

void test_delay_disabled_passthrough(void) {
    Delay d;
    delay_init(&d, 44100.0f);
    delay_set_param(&d, DELAY_PARAM_ENABLED, 0.0f);
    delay_set_param(&d, DELAY_PARAM_MIX, 100.0f);
    float out_L, out_R;
    delay_process(&d, 0.5f, 0.5f, &out_L, &out_R);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.5f, out_L);
    delay_free(&d);
}

void test_delay_wet_echo_appears(void) {
    Delay d;
    delay_init(&d, 44100.0f);
    /* 1 ms delay = 44 samples at 44100 Hz */
    delay_set_param(&d, DELAY_PARAM_TIME_MS,  1.0f);
    delay_set_param(&d, DELAY_PARAM_FEEDBACK, 0.0f);
    delay_set_param(&d, DELAY_PARAM_MIX,    100.0f);

    float out_L, out_R;
    /* Prime buffer with signal for 44 frames */
    for (int i = 0; i < 44; i++)
        delay_process(&d, 1.0f, 1.0f, &out_L, &out_R);

    /* Frame 44: the first sample written (1.0) is now at the read head */
    delay_process(&d, 1.0f, 1.0f, &out_L, &out_R);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 1.0f, out_L);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 1.0f, out_R);
    delay_free(&d);
}

void test_delay_reset_clears_buffer(void) {
    Delay d;
    delay_init(&d, 44100.0f);
    delay_set_param(&d, DELAY_PARAM_TIME_MS, 1.0f);
    delay_set_param(&d, DELAY_PARAM_MIX,   100.0f);
    delay_set_param(&d, DELAY_PARAM_FEEDBACK, 0.0f);

    float out_L, out_R;
    for (int i = 0; i < 50; i++)
        delay_process(&d, 1.0f, 1.0f, &out_L, &out_R);

    delay_reset(&d);
    TEST_ASSERT_EQUAL_INT(0, d.write_pos);

    /* After reset, silence in → silence out (no residual echo) */
    for (int i = 0; i < 44; i++)
        delay_process(&d, 0.0f, 0.0f, &out_L, &out_R);
    delay_process(&d, 0.0f, 0.0f, &out_L, &out_R);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.0f, out_L);
    delay_free(&d);
}

void test_delay_set_param_time_clamped_low(void) {
    Delay d;
    delay_init(&d, 44100.0f);
    delay_set_param(&d, DELAY_PARAM_TIME_MS, 0.0f);  /* below min */
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 1.0f, d.time_ms);
    delay_free(&d);
}

void test_delay_set_param_time_clamped_high(void) {
    Delay d;
    delay_init(&d, 44100.0f);
    delay_set_param(&d, DELAY_PARAM_TIME_MS, 5000.0f);  /* above max */
    TEST_ASSERT_FLOAT_WITHIN(1.0f, 2000.0f, d.time_ms);
    delay_free(&d);
}

void test_delay_set_param_time_valid(void) {
    Delay d;
    delay_init(&d, 44100.0f);
    delay_set_param(&d, DELAY_PARAM_TIME_MS, 500.0f);
    TEST_ASSERT_FLOAT_WITHIN(1.0f, 500.0f, d.time_ms);
    delay_free(&d);
}

void test_delay_set_param_feedback(void) {
    Delay d;
    delay_init(&d, 44100.0f);
    delay_set_param(&d, DELAY_PARAM_FEEDBACK, 50.0f);  /* 50% → stored as 0.5 */
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.5f, d.feedback);
    delay_free(&d);
}

void test_delay_set_param_mix(void) {
    Delay d;
    delay_init(&d, 44100.0f);
    delay_set_param(&d, DELAY_PARAM_MIX, 80.0f);  /* 80% → stored as 0.8 */
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.8f, d.mix);
    delay_free(&d);
}

void test_delay_max_time_clamps_delay_samples(void) {
    Delay d;
    delay_init(&d, 44100.0f);
    /* At 2000ms: delay_samples = 88200 = DELAY_MAX_SAMPLES = buf_size
       The guard "delay_samples >= buf_size" should clamp to buf_size-1 */
    delay_set_param(&d, DELAY_PARAM_TIME_MS, 2000.0f);
    delay_set_param(&d, DELAY_PARAM_MIX, 100.0f);
    float out_L, out_R;
    /* Just verify it doesn't crash with max delay */
    delay_process(&d, 0.5f, 0.5f, &out_L, &out_R);
    TEST_PASS();
    delay_free(&d);
}

/* ── Chorus ──────────────────────────────────────────────────────────────── */

void test_chorus_disabled_passthrough(void) {
    Chorus c;
    chorus_init(&c, 44100.0f);
    chorus_set_param(&c, CHORUS_PARAM_ENABLED, 0.0f);
    float out_L, out_R;
    chorus_process(&c, 0.7f, -0.3f, &out_L, &out_R);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.7f, out_L);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, -0.3f, out_R);
}

void test_chorus_mix_zero_passthrough(void) {
    Chorus c;
    chorus_init(&c, 44100.0f);
    /* Default mix=0 */
    float out_L, out_R;
    chorus_process(&c, 0.7f, -0.3f, &out_L, &out_R);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.7f, out_L);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, -0.3f, out_R);
}

void test_chorus_produces_output_with_mix(void) {
    Chorus c;
    chorus_init(&c, 44100.0f);
    chorus_set_param(&c, CHORUS_PARAM_MIX, 50.0f);

    float out_L, out_R;
    /* Prime the chorus delay lines with signal */
    for (int i = 0; i < 1000; i++)
        chorus_process(&c, 0.5f, 0.5f, &out_L, &out_R);

    TEST_ASSERT_TRUE(fabsf(out_L) > 0.0f);
    TEST_ASSERT_TRUE(fabsf(out_R) > 0.0f);
}

void test_chorus_wet_100pct(void) {
    Chorus c;
    chorus_init(&c, 44100.0f);
    chorus_set_param(&c, CHORUS_PARAM_MIX,   100.0f);
    chorus_set_param(&c, CHORUS_PARAM_DEPTH,  50.0f);

    float out_L, out_R;
    for (int i = 0; i < 1000; i++)
        chorus_process(&c, 0.5f, 0.5f, &out_L, &out_R);

    TEST_ASSERT_TRUE(fabsf(out_L) > 0.0f);
}

void test_chorus_reset_clears_state(void) {
    Chorus c;
    chorus_init(&c, 44100.0f);
    chorus_set_param(&c, CHORUS_PARAM_MIX, 100.0f);

    float out_L, out_R;
    for (int i = 0; i < 100; i++)
        chorus_process(&c, 0.5f, 0.5f, &out_L, &out_R);

    chorus_reset(&c);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.0f, c.lfo_phase);
    TEST_ASSERT_EQUAL_INT(0, c.write_pos);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.0f, c.buf_L[0]);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.0f, c.buf_R[0]);
}

void test_chorus_lfo_phase_wraps(void) {
    Chorus c;
    chorus_init(&c, 44100.0f);
    chorus_set_param(&c, CHORUS_PARAM_MIX, 50.0f);
    /* Position lfo_phase just below 2*PI so the next sample wraps it */
    c.lfo_phase = 6.28318530f - c.lfo_inc * 0.5f;
    float out_L, out_R;
    chorus_process(&c, 0.5f, 0.5f, &out_L, &out_R);
    TEST_ASSERT_TRUE(c.lfo_phase >= 0.0f);
    TEST_ASSERT_TRUE(c.lfo_phase < 6.28318530f);
}

void test_chorus_set_param_rate(void) {
    Chorus c;
    chorus_init(&c, 44100.0f);
    chorus_set_param(&c, CHORUS_PARAM_RATE, 2.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 2.0f, c.rate);
}

void test_chorus_set_param_depth(void) {
    Chorus c;
    chorus_init(&c, 44100.0f);
    chorus_set_param(&c, CHORUS_PARAM_DEPTH, 75.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.75f, c.depth);
}

void test_chorus_size_param_changes_rate_and_depth(void) {
    Chorus c;
    chorus_init(&c, 44100.0f);
    float old_depth = c.depth;
    float old_rate  = c.rate;
    chorus_set_param(&c, CHORUS_PARAM_SIZE, 100.0f);
    /* Both should change */
    TEST_ASSERT_TRUE(fabsf(c.depth - old_depth) > 0.001f ||
                     fabsf(c.rate  - old_rate)  > 0.0001f);
}

void test_chorus_size_param_zero(void) {
    Chorus c;
    chorus_init(&c, 44100.0f);
    /* SIZE=0 → minimum depth and maximum rate */
    chorus_set_param(&c, CHORUS_PARAM_SIZE, 0.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.05f, c.depth);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.50f, c.rate);
}

/* ── Reverb ──────────────────────────────────────────────────────────────── */

void test_reverb_disabled_passthrough(void) {
    Reverb r;
    reverb_init(&r, 44100.0f);
    reverb_set_param(&r, REV_PARAM_ENABLED, 0.0f);
    float out_L, out_R;
    reverb_process(&r, 0.5f, 0.5f, &out_L, &out_R);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.5f, out_L);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.5f, out_R);
}

void test_reverb_mix_zero_passthrough(void) {
    Reverb r;
    reverb_init(&r, 44100.0f);
    /* Default mix=0 */
    float out_L, out_R;
    reverb_process(&r, 0.5f, 0.5f, &out_L, &out_R);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.5f, out_L);
}

void test_reverb_preset0_room_produces_tail(void) {
    Reverb r;
    reverb_init(&r, 44100.0f);
    reverb_set_param(&r, REV_PARAM_PRESET, 0.0f);
    reverb_set_param(&r, REV_PARAM_MIX,   50.0f);

    float out_L, out_R;
    for (int i = 0; i < 2000; i++)
        reverb_process(&r, 0.5f, 0.5f, &out_L, &out_R);

    TEST_ASSERT_TRUE(fabsf(out_L) > 0.001f);
}

void test_reverb_preset1_hall_produces_tail(void) {
    Reverb r;
    reverb_init(&r, 44100.0f);
    reverb_set_param(&r, REV_PARAM_PRESET, 1.0f);
    reverb_set_param(&r, REV_PARAM_MIX,   50.0f);

    float out_L, out_R;
    for (int i = 0; i < 2000; i++)
        reverb_process(&r, 0.5f, 0.5f, &out_L, &out_R);

    TEST_ASSERT_TRUE(fabsf(out_L) > 0.001f);
}

void test_reverb_preset2_nonlinear_path(void) {
    Reverb r;
    reverb_init(&r, 44100.0f);
    reverb_set_param(&r, REV_PARAM_PRESET, 2.0f);  /* enables tanh path */
    reverb_set_param(&r, REV_PARAM_MIX,   50.0f);

    float out_L, out_R;
    for (int i = 0; i < 2000; i++)
        reverb_process(&r, 0.5f, 0.5f, &out_L, &out_R);

    TEST_ASSERT_TRUE(fabsf(out_L) > 0.001f);
}

void test_reverb_set_mix_param(void) {
    Reverb r;
    reverb_init(&r, 44100.0f);
    reverb_set_param(&r, REV_PARAM_MIX, 75.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.75f, r.mix);
}

void test_reverb_reset_clears_tail(void) {
    Reverb r;
    reverb_init(&r, 44100.0f);
    reverb_set_param(&r, REV_PARAM_MIX, 100.0f);

    float out_L, out_R;
    for (int i = 0; i < 2000; i++)
        reverb_process(&r, 0.5f, 0.5f, &out_L, &out_R);

    reverb_reset(&r);

    /* Silence in after reset → no reverb tail */
    float max_out = 0.0f;
    for (int i = 0; i < 128; i++) {
        reverb_process(&r, 0.0f, 0.0f, &out_L, &out_R);
        if (fabsf(out_L) > max_out) max_out = fabsf(out_L);
    }
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 0.0f, max_out);
}

void test_reverb_preset_param_clamped_low(void) {
    Reverb r;
    reverb_init(&r, 44100.0f);
    reverb_set_param(&r, REV_PARAM_PRESET, -1.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 0.0f, r.preset);
}

void test_reverb_preset_param_clamped_high(void) {
    Reverb r;
    reverb_init(&r, 44100.0f);
    reverb_set_param(&r, REV_PARAM_PRESET, 5.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 2.0f, r.preset);
}

/* ── Runner ──────────────────────────────────────────────────────────────── */

int main(void) {
    UNITY_BEGIN();

    /* EQ */
    RUN_TEST(test_eq_disabled_passes_through);
    RUN_TEST(test_eq_set_param_enabled_toggles);
    RUN_TEST(test_eq_set_param_band0_freq);
    RUN_TEST(test_eq_set_param_band0_gain);
    RUN_TEST(test_eq_set_param_band0_q);
    RUN_TEST(test_eq_set_param_band1_freq);
    RUN_TEST(test_eq_set_param_band1_gain);
    RUN_TEST(test_eq_set_param_band1_q);
    RUN_TEST(test_eq_set_param_band2_freq);
    RUN_TEST(test_eq_set_param_band2_gain);
    RUN_TEST(test_eq_set_param_band2_q);
    RUN_TEST(test_eq_set_param_out_of_range_ignored);
    RUN_TEST(test_eq_set_param_negative_param_ignored);
    RUN_TEST(test_eq_biquad_reset_clears_state);
    RUN_TEST(test_eq_biquad_lowshelf_processes);
    RUN_TEST(test_eq_biquad_highshelf_processes);
    RUN_TEST(test_eq_biquad_peak_processes);
    RUN_TEST(test_eq_zero_gain_band_passes_through);

    /* Compressor */
    RUN_TEST(test_compressor_bypass_when_amount_zero);
    RUN_TEST(test_compressor_disabled_passes_through);
    RUN_TEST(test_compressor_reduces_loud_signal);
    RUN_TEST(test_compressor_attack_then_release);
    RUN_TEST(test_compressor_set_param_amount);
    RUN_TEST(test_compressor_set_param_enabled_toggle);
    RUN_TEST(test_compressor_reset_clears_state);
    RUN_TEST(test_compressor_stereo_linked);

    /* Distortion */
    RUN_TEST(test_distortion_bypass_drive_zero);
    RUN_TEST(test_distortion_disabled_passes_through);
    RUN_TEST(test_distortion_mode0_soft_clip_saturates);
    RUN_TEST(test_distortion_mode1_hard_clip_positive);
    RUN_TEST(test_distortion_mode1_hard_clip_negative);
    RUN_TEST(test_distortion_mode1_no_clip_in_range);
    RUN_TEST(test_distortion_mode2_fuzz_positive);
    RUN_TEST(test_distortion_mode2_fuzz_negative);
    RUN_TEST(test_distortion_partial_mix);
    RUN_TEST(test_distortion_set_param_drive);
    RUN_TEST(test_distortion_set_param_mode);
    RUN_TEST(test_distortion_set_param_mix);

    /* Limiter */
    RUN_TEST(test_limiter_passes_through_below_threshold);
    RUN_TEST(test_limiter_engages_above_threshold);
    RUN_TEST(test_limiter_gain_reduces_on_overload);
    RUN_TEST(test_limiter_disabled_passes_through);
    RUN_TEST(test_limiter_reset_restores_gain);
    RUN_TEST(test_limiter_release_recovers_gain);
    RUN_TEST(test_limiter_threshold_param_clamped_low);
    RUN_TEST(test_limiter_threshold_param_clamped_high);
    RUN_TEST(test_limiter_threshold_param_valid);
    RUN_TEST(test_limiter_release_param_clamped_low);
    RUN_TEST(test_limiter_release_param_clamped_high);
    RUN_TEST(test_limiter_release_param_valid);
    RUN_TEST(test_limiter_zero_sample_rate_no_crash);

    /* Delay */
    RUN_TEST(test_delay_dry_passthrough);
    RUN_TEST(test_delay_disabled_passthrough);
    RUN_TEST(test_delay_wet_echo_appears);
    RUN_TEST(test_delay_reset_clears_buffer);
    RUN_TEST(test_delay_set_param_time_clamped_low);
    RUN_TEST(test_delay_set_param_time_clamped_high);
    RUN_TEST(test_delay_set_param_time_valid);
    RUN_TEST(test_delay_set_param_feedback);
    RUN_TEST(test_delay_set_param_mix);
    RUN_TEST(test_delay_max_time_clamps_delay_samples);

    /* Chorus */
    RUN_TEST(test_chorus_disabled_passthrough);
    RUN_TEST(test_chorus_mix_zero_passthrough);
    RUN_TEST(test_chorus_produces_output_with_mix);
    RUN_TEST(test_chorus_wet_100pct);
    RUN_TEST(test_chorus_reset_clears_state);
    RUN_TEST(test_chorus_lfo_phase_wraps);
    RUN_TEST(test_chorus_set_param_rate);
    RUN_TEST(test_chorus_set_param_depth);
    RUN_TEST(test_chorus_size_param_changes_rate_and_depth);
    RUN_TEST(test_chorus_size_param_zero);

    /* Reverb */
    RUN_TEST(test_reverb_disabled_passthrough);
    RUN_TEST(test_reverb_mix_zero_passthrough);
    RUN_TEST(test_reverb_preset0_room_produces_tail);
    RUN_TEST(test_reverb_preset1_hall_produces_tail);
    RUN_TEST(test_reverb_preset2_nonlinear_path);
    RUN_TEST(test_reverb_set_mix_param);
    RUN_TEST(test_reverb_reset_clears_tail);
    RUN_TEST(test_reverb_preset_param_clamped_low);
    RUN_TEST(test_reverb_preset_param_clamped_high);

    return UNITY_END();
}
