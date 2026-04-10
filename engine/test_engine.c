/*
 * Core engine tests — Unity test framework.
 * Compile via: make test-c (from project root)
 */
#include "vendor/unity/unity.h"
#include "engine.h"
#include "track.h"
#include "plugin_ids.h"
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

/* Allocate a PCM buffer filled with `value` and add it as a track.
   Uses the chunked API: engine_add_track_chunked() allocates the slot, then
   engine_load_chunk() takes ownership of the malloc'd buffers. */
static int add_constant_track(float value) {
    float *sig_L = malloc(PCM_LEN * sizeof(float));
    float *sig_R = malloc(PCM_LEN * sizeof(float));
    for (int i = 0; i < PCM_LEN; i++) { sig_L[i] = value; sig_R[i] = value; }
    int tid = engine_add_track_chunked(PCM_LEN, 44100.0f);
    if (tid >= 0) {
        engine_load_chunk(tid, sig_L, sig_R, 0, PCM_LEN);
        /* ownership transferred; do NOT free sig_L/sig_R here */
    } else {
        free(sig_L);
        free(sig_R);
    }
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
    g_tid = engine_add_track_chunked(PCM_LEN, 44100.0f);
    engine_load_chunk(g_tid, pcm_L, pcm_R, 0, PCM_LEN);
    /* ownership transferred — do NOT free pcm_L/pcm_R */

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
    g_tid = engine_add_track_chunked(PCM_LEN, 44100.0f);
    engine_load_chunk(g_tid, pcm_L, pcm_R, 0, PCM_LEN);
    /* ownership transferred */

    float out_L[FRAMES], out_R[FRAMES];
    engine_play();
    engine_seek(0);
    engine_process(out_L, out_R, FRAMES);

    TEST_ASSERT_EQUAL_INT(FRAMES, (int)engine_get_playhead());
}

void test_nonzero_pcm_produces_audible_output(void) {
    g_tid = add_constant_track(0.5f);
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

void test_start_frame_silence_before_offset(void) {
    /* Track starts at frame 64 — first 64 frames must be silent */
    g_tid = add_constant_track(0.5f);
    engine_set_start_frame(g_tid, 64);
    engine_play();

    float out_L[FRAMES], out_R[FRAMES];
    engine_process(out_L, out_R, 64);  /* first 64 frames */

    for (int i = 0; i < 64; i++) {
        TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.0f, out_L[i]);
        TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.0f, out_R[i]);
    }
}

void test_start_frame_audio_at_offset(void) {
    /* Track starts at frame 64 — frames 64+ must carry audio */
    g_tid = add_constant_track(0.5f);
    engine_set_start_frame(g_tid, 64);
    engine_play();

    float out_L[FRAMES], out_R[FRAMES];
    engine_process(out_L, out_R, FRAMES);  /* 128 frames; frames 64-127 have audio */

    /* Frame 64 (local index 0 in PCM) should be non-zero */
    TEST_ASSERT_FLOAT_NOT_WITHIN(1e-7f, 0.0f, out_L[64]);
    TEST_ASSERT_FLOAT_NOT_WITHIN(1e-7f, 0.0f, out_R[64]);
}

void test_start_frame_zero_is_default_behaviour(void) {
    /* start_frame=0 must behave identically to the pre-existing behaviour */
    g_tid = add_constant_track(0.5f);
    /* do NOT call engine_set_start_frame — default should be 0 */
    engine_play();

    float out_L[FRAMES], out_R[FRAMES];
    engine_process(out_L, out_R, FRAMES);

    float expected = tanhf(0.5f * cosf(3.14159265f / 4.0f));
    TEST_ASSERT_FLOAT_WITHIN(0.001f, expected, out_L[0]);
}

void test_set_start_frame_invalid_id_no_crash(void) {
    /* Must not crash or corrupt state for out-of-range IDs */
    engine_set_start_frame(-1, 100);
    engine_set_start_frame(32, 100);  /* MAX_TRACKS = 32 */
    engine_set_start_frame(99, 100);
    TEST_PASS();
}

void test_master_gain_scales_output(void) {
    g_tid = add_constant_track(0.5f);
    engine_play();

    /* With master_gain=1.0 (default) */
    float out_L1[FRAMES], out_R1[FRAMES];
    engine_process(out_L1, out_R1, FRAMES);

    engine_pause();
    engine_seek(0);
    engine_remove_track(g_tid);

    /* With master_gain=2.0 */
    g_tid = add_constant_track(0.5f);
    engine_set_master_gain(2.0f);
    engine_play();

    float out_L2[FRAMES], out_R2[FRAMES];
    engine_process(out_L2, out_R2, FRAMES);

    engine_set_master_gain(1.0f);  /* restore for other tests */

    /* Higher master gain → different (typically louder but saturated) output */
    TEST_ASSERT_FLOAT_NOT_WITHIN(1e-4f, out_L1[0], out_L2[0]);
}

void test_chunk_remaining_with_loaded_chunk(void) {
    g_tid = add_constant_track(0.5f);  /* chunk_length=PCM_LEN=1024, start=0 */

    /* At playhead=0, remaining = chunk_end - src_frame = 1024 - 0 = 1024 */
    long remaining = engine_chunk_remaining(g_tid, 0);
    TEST_ASSERT_EQUAL_INT(PCM_LEN, (int)remaining);
}

void test_chunk_remaining_inactive_returns_zero(void) {
    TEST_ASSERT_EQUAL_INT(0, (int)engine_chunk_remaining(-1, 0));
    TEST_ASSERT_EQUAL_INT(0, (int)engine_chunk_remaining(31, 0));
}

void test_chunk_remaining_zero_when_past_end(void) {
    g_tid = add_constant_track(0.5f);
    /* playhead past the chunk end → remaining = 0 */
    long remaining = engine_chunk_remaining(g_tid, PCM_LEN + 100);
    TEST_ASSERT_EQUAL_INT(0, (int)remaining);
}

void test_load_chunk_invalid_id_no_crash(void) {
    /* engine_load_chunk should free the buffers and return for invalid id */
    float* L = (float*)malloc(64 * sizeof(float));
    float* R = (float*)malloc(64 * sizeof(float));
    engine_load_chunk(-1, L, R, 0, 64);  /* L and R are freed inside */
    TEST_PASS();
}

void test_future_chunk_promoted_at_boundary(void) {
    /* Create a track large enough for two chunks */
    float *L1 = calloc(PCM_LEN, sizeof(float));
    float *R1 = calloc(PCM_LEN, sizeof(float));
    float *L2 = (float*)malloc(PCM_LEN * sizeof(float));
    float *R2 = (float*)malloc(PCM_LEN * sizeof(float));

    for (int i = 0; i < PCM_LEN; i++) { L2[i] = 0.5f; R2[i] = 0.5f; }

    g_tid = engine_add_track_chunked(2 * PCM_LEN, 44100.0f);
    engine_load_chunk(g_tid, L1, R1, 0, PCM_LEN);
    /* chunk_start > src_frame=0 → queued as future chunk */
    engine_load_chunk(g_tid, L2, R2, PCM_LEN, PCM_LEN);

    engine_play();

    /* Process PCM_LEN frames to exhaust first chunk and trigger promotion */
    float out_L[FRAMES], out_R[FRAMES];
    int blocks = PCM_LEN / FRAMES;
    for (int b = 0; b < blocks; b++)
        engine_process(out_L, out_R, FRAMES);

    /* chunk2: start=PCM_LEN, length=PCM_LEN → remaining = 2*PCM_LEN - PCM_LEN = PCM_LEN */
    long remaining = engine_chunk_remaining(g_tid, (long)PCM_LEN);
    TEST_ASSERT_EQUAL_INT(PCM_LEN, (int)remaining);

    /* Process a block from the second chunk — should be non-zero */
    engine_process(out_L, out_R, FRAMES);
    float expected = tanhf(0.5f * cosf(3.14159265f / 4.0f));
    TEST_ASSERT_FLOAT_WITHIN(0.001f, expected, out_L[0]);
}

void test_track_produces_silence_past_end(void) {
    /* Short track: only 64 frames — process 128, last 64 must be silent */
    float *L = (float*)malloc(64 * sizeof(float));
    float *R = (float*)malloc(64 * sizeof(float));
    for (int i = 0; i < 64; i++) { L[i] = 0.5f; R[i] = 0.5f; }
    g_tid = engine_add_track_chunked(64, 44100.0f);
    engine_load_chunk(g_tid, L, R, 0, 64);

    engine_play();
    float out_L[FRAMES], out_R[FRAMES];
    engine_process(out_L, out_R, FRAMES);  /* 128 frames, track only has 64 */

    /* Frames 64-127 are past num_frames — must be silent */
    for (int i = 64; i < FRAMES; i++) {
        TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.0f, out_L[i]);
        TEST_ASSERT_FLOAT_WITHIN(1e-7f, 0.0f, out_R[i]);
    }
}

void test_replace_existing_chunk(void) {
    /* Load chunk A, then replace with chunk B at the same start position.
       Exercises the "if (t->chunk_L) free(t->chunk_L)" path. */
    float *L1 = (float*)malloc(PCM_LEN * sizeof(float));
    float *R1 = (float*)malloc(PCM_LEN * sizeof(float));
    float *L2 = (float*)malloc(PCM_LEN * sizeof(float));
    float *R2 = (float*)malloc(PCM_LEN * sizeof(float));
    for (int i = 0; i < PCM_LEN; i++) { L1[i] = 0.2f; R1[i] = 0.2f; }
    for (int i = 0; i < PCM_LEN; i++) { L2[i] = 0.8f; R2[i] = 0.8f; }

    g_tid = engine_add_track_chunked(PCM_LEN, 44100.0f);
    engine_load_chunk(g_tid, L1, R1, 0, PCM_LEN);
    engine_load_chunk(g_tid, L2, R2, 0, PCM_LEN);  /* frees L1/R1, installs L2/R2 */

    engine_play();
    float out_L[FRAMES], out_R[FRAMES];
    engine_process(out_L, out_R, FRAMES);

    /* Audio from L2 (0.8) should be audible */
    float expected = tanhf(0.8f * cosf(3.14159265f / 4.0f));
    TEST_ASSERT_FLOAT_WITHIN(0.001f, expected, out_L[0]);
}

void test_chunk_remaining_with_next_chunk_queued(void) {
    /* Two chunks loaded: current at 0 and future at PCM_LEN.
       chunk_remaining while next_chunk is queued should report next_chunk's end. */
    float *L1 = calloc(PCM_LEN, sizeof(float));
    float *R1 = calloc(PCM_LEN, sizeof(float));
    float *L2 = (float*)malloc(PCM_LEN * sizeof(float));
    float *R2 = (float*)malloc(PCM_LEN * sizeof(float));
    for (int i = 0; i < PCM_LEN; i++) { L2[i] = 0.5f; R2[i] = 0.5f; }

    g_tid = engine_add_track_chunked(2 * PCM_LEN, 44100.0f);
    engine_load_chunk(g_tid, L1, R1, 0, PCM_LEN);
    engine_load_chunk(g_tid, L2, R2, PCM_LEN, PCM_LEN);  /* queued as next_chunk */

    /* At playhead=0, next_chunk is still queued: remaining = 2*PCM_LEN - 0 */
    long remaining = engine_chunk_remaining(g_tid, 0);
    TEST_ASSERT_EQUAL_INT(2 * PCM_LEN, (int)remaining);
}

void test_replace_queued_next_chunk(void) {
    /* Load current chunk + two future chunks; second future replaces first.
       Exercises "if (t->next_chunk_L) free(t->next_chunk_L)" in load_chunk. */
    float *L1 = calloc(PCM_LEN, sizeof(float));
    float *R1 = calloc(PCM_LEN, sizeof(float));
    float *L2 = (float*)malloc(PCM_LEN * sizeof(float));
    float *R2 = (float*)malloc(PCM_LEN * sizeof(float));
    float *L3 = (float*)malloc(PCM_LEN * sizeof(float));
    float *R3 = (float*)malloc(PCM_LEN * sizeof(float));
    for (int i = 0; i < PCM_LEN; i++) { L2[i] = 0.4f; R2[i] = 0.4f; }
    for (int i = 0; i < PCM_LEN; i++) { L3[i] = 0.7f; R3[i] = 0.7f; }

    g_tid = engine_add_track_chunked(2 * PCM_LEN, 44100.0f);
    engine_load_chunk(g_tid, L1, R1, 0, PCM_LEN);
    engine_load_chunk(g_tid, L2, R2, PCM_LEN, PCM_LEN);  /* first next_chunk */
    engine_load_chunk(g_tid, L3, R3, PCM_LEN, PCM_LEN);  /* replaces L2/R2 */

    engine_play();
    float out_L[FRAMES], out_R[FRAMES];
    int blocks = PCM_LEN / FRAMES;
    for (int b = 0; b < blocks; b++)
        engine_process(out_L, out_R, FRAMES);

    /* First block from the second (L3) chunk should have 0.7 signal */
    engine_process(out_L, out_R, FRAMES);
    float expected = tanhf(0.7f * cosf(3.14159265f / 4.0f));
    TEST_ASSERT_FLOAT_WITHIN(0.001f, expected, out_L[0]);
}

void test_plugin_set_param_all_plugin_ids(void) {
    /* Exercise all 7 plugin_id switch cases in engine_plugin_set_param */
    g_tid = add_constant_track(0.5f);
    engine_plugin_set_param(g_tid, PLUGIN_EQ,         EQ_PARAM_ENABLED,    1.0f);
    engine_plugin_set_param(g_tid, PLUGIN_COMPRESSOR, COMP_PARAM_AMOUNT,   50.0f);
    engine_plugin_set_param(g_tid, PLUGIN_DISTORTION, DIST_PARAM_DRIVE,    30.0f);
    engine_plugin_set_param(g_tid, PLUGIN_LIMITER,    LIM_PARAM_THRESHOLD, -6.0f);
    engine_plugin_set_param(g_tid, PLUGIN_DELAY,      DELAY_PARAM_MIX,     50.0f);
    engine_plugin_set_param(g_tid, PLUGIN_CHORUS,     CHORUS_PARAM_MIX,    50.0f);
    engine_plugin_set_param(g_tid, PLUGIN_REVERB,     REV_PARAM_MIX,       50.0f);
    TEST_PASS();
}

void test_load_chunk_cancels_queued_next_chunk(void) {
    /* Load current chunk + queue a future chunk, then reload at the same
       start position — the queued next_chunk must be freed and cancelled. */
    float *L1 = calloc(PCM_LEN, sizeof(float));
    float *R1 = calloc(PCM_LEN, sizeof(float));
    float *L2 = (float*)malloc(PCM_LEN * sizeof(float));
    float *R2 = (float*)malloc(PCM_LEN * sizeof(float));
    float *L3 = (float*)malloc(PCM_LEN * sizeof(float));
    float *R3 = (float*)malloc(PCM_LEN * sizeof(float));
    for (int i = 0; i < PCM_LEN; i++) { L2[i] = 0.5f; R2[i] = 0.5f; }
    for (int i = 0; i < PCM_LEN; i++) { L3[i] = 0.8f; R3[i] = 0.8f; }

    g_tid = engine_add_track_chunked(2 * PCM_LEN, 44100.0f);
    engine_load_chunk(g_tid, L1, R1, 0, PCM_LEN);              /* current chunk  */
    engine_load_chunk(g_tid, L2, R2, PCM_LEN, PCM_LEN);        /* queued future  */
    /* Reload at same start (chunk_start=0 <= src_frame=0): installs immediately
       and must cancel the queued future chunk (free L2/R2, set next_chunk=NULL). */
    engine_load_chunk(g_tid, L3, R3, 0, PCM_LEN);

    engine_play();
    float out_L[FRAMES], out_R[FRAMES];
    engine_process(out_L, out_R, FRAMES);

    float expected = tanhf(0.8f * cosf(3.14159265f / 4.0f));
    TEST_ASSERT_FLOAT_WITHIN(0.001f, expected, out_L[0]);
}

void test_deferred_seek_applies_after_fadeout(void) {
    g_tid = add_constant_track(0.5f);
    engine_play();

    float out_L[FRAMES], out_R[FRAMES];
    /* Seek while playing — deferred */
    engine_seek(0);
    /* Block 1: fade-out from current position */
    engine_process(out_L, out_R, FRAMES);
    /* Block 2: seek applied at start, fade-in begins; playhead should be at FRAMES */
    engine_process(out_L, out_R, FRAMES);
    TEST_ASSERT_EQUAL_INT(FRAMES, (int)engine_get_playhead());
}

void test_add_track_returns_minus_one_when_full(void) {
    /* Fill all MAX_TRACKS slots then verify the (MAX_TRACKS+1)th add returns -1 */
    int ids[MAX_TRACKS];
    for (int i = 0; i < MAX_TRACKS; i++) {
        ids[i] = engine_add_track_chunked(64, 44100.0f);
        TEST_ASSERT_GREATER_OR_EQUAL_INT(0, ids[i]);
    }
    int extra = engine_add_track_chunked(64, 44100.0f);
    TEST_ASSERT_EQUAL_INT(-1, extra);
    /* Clean up every slot so subsequent tests start with an empty engine */
    for (int i = 0; i < MAX_TRACKS; i++) {
        if (ids[i] >= 0) engine_remove_track(ids[i]);
    }
}

void test_chunk_remaining_zero_past_next_chunk_end(void) {
    /* Load two chunks; query with playhead past the end of the second chunk.
       Exercises the next_chunk-path ternary false branch (remaining <= 0 → 0). */
    float *L1 = calloc(PCM_LEN, sizeof(float));
    float *R1 = calloc(PCM_LEN, sizeof(float));
    float *L2 = calloc(PCM_LEN, sizeof(float));
    float *R2 = calloc(PCM_LEN, sizeof(float));

    g_tid = engine_add_track_chunked(2 * PCM_LEN, 44100.0f);
    engine_load_chunk(g_tid, L1, R1, 0, PCM_LEN);
    engine_load_chunk(g_tid, L2, R2, PCM_LEN, PCM_LEN); /* queued future chunk */

    /* Playhead 100 frames past next_chunk end → remaining < 0 → returns 0 */
    long remaining = engine_chunk_remaining(g_tid, 2 * PCM_LEN + 100);
    TEST_ASSERT_EQUAL_INT(0, (int)remaining);
}

void test_invalid_id_per_track_setters_no_crash(void) {
    /* All per-track setters must tolerate invalid IDs.
       Covers the early-return guard regions in engine_remove_track,
       engine_set_gain/pan/mute/solo, and engine_plugin_set_param. */
    engine_remove_track(-1);
    engine_remove_track(MAX_TRACKS);
    engine_set_gain(-1, 1.0f);
    engine_set_pan(-1, 0.0f);
    engine_set_mute(-1, 1);
    engine_set_solo(-1, 1);
    engine_plugin_set_param(-1, PLUGIN_EQ, EQ_PARAM_ENABLED, 1.0f);
    TEST_PASS();
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
    RUN_TEST(test_start_frame_silence_before_offset);
    RUN_TEST(test_start_frame_audio_at_offset);
    RUN_TEST(test_start_frame_zero_is_default_behaviour);
    RUN_TEST(test_set_start_frame_invalid_id_no_crash);
    RUN_TEST(test_master_gain_scales_output);
    RUN_TEST(test_chunk_remaining_with_loaded_chunk);
    RUN_TEST(test_chunk_remaining_inactive_returns_zero);
    RUN_TEST(test_chunk_remaining_zero_when_past_end);
    RUN_TEST(test_load_chunk_invalid_id_no_crash);
    RUN_TEST(test_future_chunk_promoted_at_boundary);
    RUN_TEST(test_track_produces_silence_past_end);
    RUN_TEST(test_replace_existing_chunk);
    RUN_TEST(test_chunk_remaining_with_next_chunk_queued);
    RUN_TEST(test_replace_queued_next_chunk);
    RUN_TEST(test_plugin_set_param_all_plugin_ids);
    RUN_TEST(test_load_chunk_cancels_queued_next_chunk);
    RUN_TEST(test_deferred_seek_applies_after_fadeout);
    RUN_TEST(test_add_track_returns_minus_one_when_full);
    RUN_TEST(test_chunk_remaining_zero_past_next_chunk_end);
    RUN_TEST(test_invalid_id_per_track_setters_no_crash);
    return UNITY_END();
}
