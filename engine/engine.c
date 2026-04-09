#include "engine.h"
#include "track.h"
#include "compressor.h"
#include "distortion.h"
#include "limiter.h"
#include "delay.h"
#include "chorus.h"
#include "reverb.h"
#include "plugin_ids.h"
#include <stdlib.h>
#include <string.h>
#include <math.h>

/* ---- State ---- */
static Track  g_tracks[MAX_TRACKS];
static float  g_master_gain  = 1.0f;
static long   g_playhead     = 0;
static int    g_playing      = 0;
static float  g_sample_rate  = 44100.0f;
static int    g_initialized  = 0;

static void ensure_init(void) {
    if (g_initialized) return;
    for (int i = 0; i < MAX_TRACKS; i++) {
        track_init(&g_tracks[i], g_sample_rate);
    }
    g_initialized = 1;
}

/* ---- Solo bus helpers ---- */
static int any_solo_active(void) {
    for (int i = 0; i < MAX_TRACKS; i++) {
        if (g_tracks[i].active && g_tracks[i].soloed) return 1;
    }
    return 0;
}

/* ---- Track lifecycle ---- */
int engine_add_track(float* pcm_L, float* pcm_R,
                     long num_frames, float sample_rate) {
    ensure_init();
    g_sample_rate = sample_rate;

    for (int i = 0; i < MAX_TRACKS; i++) {
        if (!g_tracks[i].active) {
            track_init(&g_tracks[i], sample_rate);

            /* Take ownership of the caller-allocated PCM buffers.
               The worklet allocates them with malloc(); track_free() will free()
               them.  This avoids a second malloc+memcpy and halves peak memory
               during loading (one copy in the heap, not two). */
            g_tracks[i].pcm_L = pcm_L;
            g_tracks[i].pcm_R = pcm_R; /* NULL for mono — track.c handles fallback */

            g_tracks[i].num_frames = num_frames;
            g_tracks[i].active     = 1;
            return i;
        }
    }
    return -1; /* no free slots */
}

void engine_remove_track(int id) {
    if (id < 0 || id >= MAX_TRACKS) return;
    track_free(&g_tracks[id]);
}

int engine_get_track_count(void) {
    int count = 0;
    for (int i = 0; i < MAX_TRACKS; i++) {
        if (g_tracks[i].active) count++;
    }
    return count;
}

/* ---- Per-track params ---- */
void engine_set_gain(int id, float gain) {
    if (id < 0 || id >= MAX_TRACKS || !g_tracks[id].active) return;
    g_tracks[id].gain = gain;
}

void engine_set_pan(int id, float pan) {
    if (id < 0 || id >= MAX_TRACKS || !g_tracks[id].active) return;
    g_tracks[id].pan = pan;
}

void engine_set_mute(int id, int muted) {
    if (id < 0 || id >= MAX_TRACKS || !g_tracks[id].active) return;
    g_tracks[id].muted = muted;
}

void engine_set_solo(int id, int soloed) {
    if (id < 0 || id >= MAX_TRACKS || !g_tracks[id].active) return;
    g_tracks[id].soloed = soloed;
}

void engine_set_start_frame(int id, long start_frame) {
    if (id < 0 || id >= MAX_TRACKS || !g_tracks[id].active) return;
    g_tracks[id].start_frame = start_frame;
}

/* ---- Plugin params ---- */
void engine_plugin_set_param(int id, int plugin_id, int param_id, float value) {
    if (id < 0 || id >= MAX_TRACKS || !g_tracks[id].active) return;
    switch (plugin_id) {
        case PLUGIN_EQ:
            eq_set_param(&g_tracks[id].eq, param_id, value, g_sample_rate);
            break;
        case PLUGIN_COMPRESSOR:
            compressor_set_param(&g_tracks[id].compressor, param_id, value);
            break;
        case PLUGIN_DISTORTION:
            distortion_set_param(&g_tracks[id].distortion, param_id, value);
            break;
        case PLUGIN_LIMITER:
            limiter_set_param(&g_tracks[id].limiter, param_id, value);
            break;
        case PLUGIN_DELAY:
            delay_set_param(&g_tracks[id].delay, param_id, value);
            break;
        case PLUGIN_CHORUS:
            chorus_set_param(&g_tracks[id].chorus, param_id, value);
            break;
        case PLUGIN_REVERB:
            reverb_set_param(&g_tracks[id].reverb, param_id, value);
            break;
    }
}

/* ---- Transport ---- */
void  engine_play (void) { g_playing = 1; }
void  engine_pause(void) { g_playing = 0; }
void  engine_seek (long pos) {
    g_playhead = pos;
    /* Reset biquad state on all tracks so stale filter memory doesn't bleed
       into the new playback position as a pop/click. */
    for (int i = 0; i < MAX_TRACKS; i++) {
        for (int b = 0; b < 3; b++) {
            biquad_reset(&g_tracks[i].eq.bands[b].filters[0]);
            biquad_reset(&g_tracks[i].eq.bands[b].filters[1]);
        }
        compressor_reset(&g_tracks[i].compressor);
        limiter_reset(&g_tracks[i].limiter);
        delay_reset(&g_tracks[i].delay);
        chorus_reset(&g_tracks[i].chorus);
        reverb_reset(&g_tracks[i].reverb);
    }
}
long  engine_get_playhead (void) { return g_playhead; }
int   engine_is_playing   (void) { return g_playing; }

void  engine_set_master_gain(float gain) { g_master_gain = gain; }

/* ---- Memory helpers ---- */
float* engine_alloc_pcm(long num_frames) {
    return (float*)malloc(num_frames * sizeof(float));
}

void engine_free_pcm(float* ptr) {
    free(ptr);
}

/* ---- Core process loop ---- */
void engine_process(float* output_L, float* output_R, int frames) {
    int solo_active = any_solo_active();

    for (int f = 0; f < frames; f++) {
        float sum_L = 0.0f;
        float sum_R = 0.0f;

        if (g_playing) {
            for (int i = 0; i < MAX_TRACKS; i++) {
                if (!g_tracks[i].active) continue;
                if (g_tracks[i].muted)   continue;
                if (solo_active && !g_tracks[i].soloed) continue;

                float tL, tR;
                track_process_frame(&g_tracks[i], g_playhead, &tL, &tR);
                sum_L += tL;
                sum_R += tR;
            }
            g_playhead++;
        }

        /* Soft clip master output */
        output_L[f] = tanhf(sum_L * g_master_gain);
        output_R[f] = tanhf(sum_R * g_master_gain);
    }
}
