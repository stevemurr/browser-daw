/*
 * Core engine tests — Unity test framework.
 * Compile via: make test-c (from project root)
 */
#include "vendor/unity/unity.h"
#include "engine.h"
#include <stdlib.h>
#include <string.h>
#include <math.h>

#define FRAMES    128
#define PCM_LEN  1024

/* Tracks added in individual tests are stored here so tearDown can clean up
   if a test fails mid-way via longjmp. -1 means no active track. */
static int g_tid  = -1;
static int g_tid2 = -1;

void setUp(void) {
    g_tid  = -1;
    g_tid2 = -1;
    engine_pause();
    engine_seek(0);
}

void tearDown(void) {
    if (g_tid >= 0)  { engine_remove_track(g_tid);  g_tid  = -1; }
    if (g_tid2 >= 0) { engine_remove_track(g_tid2); g_tid2 = -1; }
    engine_pause();
    engine_seek(0);
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

/* Allocate a PCM buffer filled with `value` and add it as a track. */
static int add_constant_track(float value) {
    float *sig_L = malloc(PCM_LEN * sizeof(float));
    float *sig_R = malloc(PCM_LEN * sizeof(float));
    for (int i = 0; i < PCM_LEN; i++) { sig_L[i] = value; sig_R[i] = value; }
    int tid = engine_add_track(sig_L, sig_R, PCM_LEN, 44100.0f);
    free(sig_L);
    free(sig_R);
    return tid;
}

/* ── Tests ──────────────────────────────────────────────────────────────── */

void test_silence_when_paused(void) {
    float out_L[FRAMES], out_R[FRAMES];
    memset(out_L, 0xFF, sizeof(out_L));
    memset(out_R, 0xFF, sizeof(out_R));

    engine_process(out_L, out_R, FRAMES);

    for (int i = 0; i < FRAMES; i++) {
        TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.0f, out_L[i]);
        TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.0f, out_R[i]);
    }
}

void test_silent_track_yields_silence(void) {
    float *pcm_L = calloc(PCM_LEN, sizeof(float));
    float *pcm_R = calloc(PCM_LEN, sizeof(float));
    g_tid = engine_add_track(pcm_L, pcm_R, PCM_LEN, 44100.0f);
    free(pcm_L);
    free(pcm_R);

    TEST_ASSERT_GREATER_OR_EQUAL_INT(0, g_tid);

    float out_L[FRAMES], out_R[FRAMES];
    engine_play();
    engine_process(out_L, out_R, FRAMES);

    for (int i = 0; i < FRAMES; i++) {
        TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.0f, out_L[i]);
        TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.0f, out_R[i]);
    }
}

void test_playhead_advances_by_block_size(void) {
    float *pcm_L = calloc(PCM_LEN, sizeof(float));
    float *pcm_R = calloc(PCM_LEN, sizeof(float));
    g_tid = engine_add_track(pcm_L, pcm_R, PCM_LEN, 44100.0f);
    free(pcm_L);
    free(pcm_R);

    float out_L[FRAMES], out_R[FRAMES];
    engine_play();
    engine_seek(0);
    engine_process(out_L, out_R, FRAMES);

    TEST_ASSERT_EQUAL_INT(FRAMES, (int)engine_get_playhead());
}

void test_nonzero_pcm_produces_audible_output(void) {
    float *sig_L = malloc(PCM_LEN * sizeof(float));
    float *sig_R = malloc(PCM_LEN * sizeof(float));
    for (int i = 0; i < PCM_LEN; i++) { sig_L[i] = 0.5f; sig_R[i] = 0.5f; }

    g_tid = engine_add_track(sig_L, sig_R, PCM_LEN, 44100.0f);
    free(sig_L);
    free(sig_R);

    engine_play();

    float out_L[FRAMES], out_R[FRAMES];
    engine_process(out_L, out_R, FRAMES);

    /* Center pan: constant-power law → pan_L = pan_R = cos(pi/4) ≈ 0.7071
       Final output: tanh(0.5 * cos(pi/4)) ≈ 0.3412 */
    float expected = tanhf(0.5f * cosf(3.14159265f / 4.0f));
    TEST_ASSERT_FLOAT_WITHIN(0.001f, expected, out_L[0]);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, expected, out_R[0]);
}

void test_muted_track_produces_silence(void) {
    g_tid = add_constant_track(0.5f);
    engine_set_mute(g_tid, 1);
    engine_play();

    float out_L[FRAMES], out_R[FRAMES];
    engine_process(out_L, out_R, FRAMES);

    for (int i = 0; i < FRAMES; i++) {
        TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.0f, out_L[i]);
        TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.0f, out_R[i]);
    }
}

void test_gain_scales_output(void) {
    g_tid = add_constant_track(0.5f);
    engine_set_gain(g_tid, 2.0f);
    engine_play();

    float out_L[FRAMES], out_R[FRAMES];
    engine_process(out_L, out_R, FRAMES);

    /* gain=2: tanh(0.5 * 2.0 * cos(pi/4)) = tanh(0.7071) ≈ 0.6088 */
    float expected = tanhf(0.5f * 2.0f * cosf(3.14159265f / 4.0f));
    TEST_ASSERT_FLOAT_WITHIN(0.001f, expected, out_L[0]);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, expected, out_R[0]);
}

void test_gain_zero_produces_silence(void) {
    g_tid = add_constant_track(0.5f);
    engine_set_gain(g_tid, 0.0f);
    engine_play();

    float out_L[FRAMES], out_R[FRAMES];
    engine_process(out_L, out_R, FRAMES);

    for (int i = 0; i < FRAMES; i++) {
        TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.0f, out_L[i]);
        TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.0f, out_R[i]);
    }
}

void test_pan_full_left(void) {
    g_tid = add_constant_track(0.5f);
    engine_set_pan(g_tid, -1.0f);
    engine_play();

    float out_L[FRAMES], out_R[FRAMES];
    engine_process(out_L, out_R, FRAMES);

    /* pan=-1: pan_angle=0 → pan_L=cos(0)=1, pan_R=sin(0)=0 */
    float expected_L = tanhf(0.5f * 1.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, expected_L, out_L[0]);
    TEST_ASSERT_FLOAT_WITHIN(1e-6f,  0.0f,       out_R[0]);
}

void test_pan_full_right(void) {
    g_tid = add_constant_track(0.5f);
    engine_set_pan(g_tid, 1.0f);
    engine_play();

    float out_L[FRAMES], out_R[FRAMES];
    engine_process(out_L, out_R, FRAMES);

    /* pan=+1: pan_angle=pi/2 → pan_L=cos(pi/2)=0, pan_R=sin(pi/2)=1 */
    float expected_R = tanhf(0.5f * 1.0f);
    TEST_ASSERT_FLOAT_WITHIN(1e-6f,  0.0f,       out_L[0]);
    TEST_ASSERT_FLOAT_WITHIN(0.001f, expected_R, out_R[0]);
}

void test_solo_isolates_track(void) {
    g_tid  = add_constant_track(0.5f);
    g_tid2 = add_constant_track(0.5f);
    engine_set_solo(g_tid, 1);  /* solo only track A */
    engine_play();

    float out_L[FRAMES], out_R[FRAMES];
    engine_process(out_L, out_R, FRAMES);

    /* Only the soloed track contributes — same as single-track output */
    float expected = tanhf(0.5f * cosf(3.14159265f / 4.0f));
    TEST_ASSERT_FLOAT_WITHIN(0.001f, expected, out_L[0]);
}

void test_solo_released_mixes_all_tracks(void) {
    g_tid  = add_constant_track(0.5f);
    g_tid2 = add_constant_track(0.5f);
    /* No solo — both tracks sum */
    engine_play();

    float out_L[FRAMES], out_R[FRAMES];
    engine_process(out_L, out_R, FRAMES);

    /* Two tracks at 0.5 center pan: sum = 2 * 0.5 * cos(pi/4) = 0.7071
       output = tanh(0.7071) ≈ 0.6088 */
    float expected = tanhf(2.0f * 0.5f * cosf(3.14159265f / 4.0f));
    TEST_ASSERT_FLOAT_WITHIN(0.001f, expected, out_L[0]);
}

void test_track_count(void) {
    TEST_ASSERT_EQUAL_INT(0, engine_get_track_count());

    g_tid  = add_constant_track(0.5f);
    g_tid2 = add_constant_track(0.5f);
    TEST_ASSERT_EQUAL_INT(2, engine_get_track_count());

    engine_remove_track(g_tid2);
    g_tid2 = -1;
    TEST_ASSERT_EQUAL_INT(1, engine_get_track_count());
}

void test_is_playing_reflects_transport(void) {
    TEST_ASSERT_FALSE(engine_is_playing());
    engine_play();
    TEST_ASSERT_TRUE(engine_is_playing());
    engine_pause();
    TEST_ASSERT_FALSE(engine_is_playing());
}

void test_alloc_free_pcm(void) {
    float *buf = engine_alloc_pcm(512);
    TEST_ASSERT_NOT_NULL(buf);
    /* Write and read back to confirm the allocation is usable */
    buf[0]   = 1.0f;
    buf[511] = 2.0f;
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 1.0f, buf[0]);
    TEST_ASSERT_FLOAT_WITHIN(1e-7f, 2.0f, buf[511]);
    engine_free_pcm(buf);
}

/* ── Runner ─────────────────────────────────────────────────────────────── */

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_silence_when_paused);
    RUN_TEST(test_silent_track_yields_silence);
    RUN_TEST(test_playhead_advances_by_block_size);
    RUN_TEST(test_nonzero_pcm_produces_audible_output);
    RUN_TEST(test_muted_track_produces_silence);
    RUN_TEST(test_gain_scales_output);
    RUN_TEST(test_gain_zero_produces_silence);
    RUN_TEST(test_pan_full_left);
    RUN_TEST(test_pan_full_right);
    RUN_TEST(test_solo_isolates_track);
    RUN_TEST(test_solo_released_mixes_all_tracks);
    RUN_TEST(test_track_count);
    RUN_TEST(test_is_playing_reflects_transport);
    RUN_TEST(test_alloc_free_pcm);
    return UNITY_END();
}
