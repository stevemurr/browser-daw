/*
 * Seek / transport tests — Unity test framework.
 * Compile via: make test-c (from project root)
 */
#include "vendor/unity/unity.h"
#include "engine.h"
#include "plugin_ids.h"
#include <stdlib.h>
#include <math.h>

#define FRAMES   128
#define PCM_LEN 4096

/* Shared track: first 512 frames silent, remainder 0.5 */
static int g_tid = -1;

void setUp(void) {
    float *sig_L = malloc(PCM_LEN * sizeof(float));
    float *sig_R = malloc(PCM_LEN * sizeof(float));
    for (int i = 0;   i < 512;    i++) { sig_L[i] = 0.0f; sig_R[i] = 0.0f; }
    for (int i = 512; i < PCM_LEN; i++) { sig_L[i] = 0.5f; sig_R[i] = 0.5f; }
    g_tid = engine_add_track_chunked(PCM_LEN, 44100.0f);
    engine_load_chunk(g_tid, sig_L, sig_R, 0, PCM_LEN);
    /* ownership transferred — do NOT free sig_L/sig_R */
    engine_play();
}

void tearDown(void) {
    if (g_tid >= 0) {
        engine_remove_track(g_tid);
        g_tid = -1;
    }
    engine_pause();
    engine_seek(0);
}

/* ── Tests ──────────────────────────────────────────────────────────────── */

void test_seek_zero_reads_silent_region(void) {
    float out_L[FRAMES], out_R[FRAMES];
    engine_seek(0);
    engine_process(out_L, out_R, FRAMES);

    for (int i = 0; i < FRAMES; i++) {
        TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.0f, out_L[i]);
    }
}

void test_seek_512_reads_signal_region(void) {
    float out_L[FRAMES], out_R[FRAMES];
    engine_seek(512);
    /* Deferred seek: first block fades out from the old position (silent). */
    engine_process(out_L, out_R, FRAMES);
    /* Seek is applied at the start of this block; fade-in reads from 512. */
    engine_process(out_L, out_R, FRAMES);

    int non_zero = 0;
    for (int i = 0; i < FRAMES; i++) {
        if (fabsf(out_L[i]) > 0.1f) { non_zero = 1; break; }
    }
    TEST_ASSERT_TRUE_MESSAGE(non_zero, "expected non-zero output from 0.5 PCM region");
    TEST_ASSERT_EQUAL_INT(512 + FRAMES, (int)engine_get_playhead());
}

void test_seek_resets_biquad_state(void) {
    /* Enable EQ with +12 dB mid-peak to make any biquad transient audible */
    engine_plugin_set_param(g_tid, PLUGIN_EQ, EQ_PARAM_ENABLED,    1.0f);
    engine_plugin_set_param(g_tid, PLUGIN_EQ, EQ_PARAM_BAND1_FREQ, 1000.0f);
    engine_plugin_set_param(g_tid, PLUGIN_EQ, EQ_PARAM_BAND1_GAIN, 12.0f);
    engine_plugin_set_param(g_tid, PLUGIN_EQ, EQ_PARAM_BAND1_Q,    0.707f);

    /* Build up biquad state by processing through the 0.5 signal region */
    float out_L[FRAMES], out_R[FRAMES];
    engine_seek(512);
    for (int b = 0; b < 8; b++) engine_process(out_L, out_R, FRAMES);

    /* engine_seek() must flush biquad state; the silent region must stay silent */
    engine_seek(0);
    /* Deferred seek: first block fades out from the signal region (non-zero). */
    engine_process(out_L, out_R, FRAMES);
    /* Seek applied at start of this block: biquad reset, fade-in from silent. */
    engine_process(out_L, out_R, FRAMES);

    for (int i = 0; i < FRAMES; i++) {
        TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.0f, out_L[i]);
    }
}

/* ── Runner ─────────────────────────────────────────────────────────────── */

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_seek_zero_reads_silent_region);
    RUN_TEST(test_seek_512_reads_signal_region);
    RUN_TEST(test_seek_resets_biquad_state);
    return UNITY_END();
}
