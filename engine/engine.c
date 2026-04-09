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

/* Allocate a track slot for a source file of num_frames total length.
   No PCM is loaded yet — call engine_load_chunk() to provide the initial chunk.
   Returns the slot id (0-31) or -1 if no slots are free. */
int engine_add_track_chunked(long num_frames, float sample_rate) {
    ensure_init();
    g_sample_rate = sample_rate;

    for (int i = 0; i < MAX_TRACKS; i++) {
        if (!g_tracks[i].active) {
            track_init(&g_tracks[i], sample_rate);
            g_tracks[i].num_frames   = num_frames;
            g_tracks[i].chunk_L     = NULL;
            g_tracks[i].chunk_R     = NULL;
            g_tracks[i].chunk_start  = 0;
            g_tracks[i].chunk_length = 0;
            g_tracks[i].active       = 1;
            return i;
        }
    }
    return -1; /* no free slots */
}

/* Load (or replace) the PCM chunk for slot `id`.
   Takes ownership of chunk_L and chunk_R — they must have been malloc'd by the
   caller (the worklet).
   chunk_start is the source-file frame offset of chunk[0].
   chunk_length is the number of frames in this chunk.

   Double-buffer semantics:
   • If chunk_start ≤ current src_frame the chunk covers the current playhead
     and is installed immediately (seek / initial load).  Any queued next_chunk
     is discarded since we are jumping to a new position.
   • If chunk_start > current src_frame the chunk is a prefetch for the future.
     It is stored in next_chunk_* and promoted to the active chunk by
     track_process_frame() the moment the playhead reaches next_chunk_start.
     The old chunk continues to provide audio until promotion so there is no
     silence at chunk boundaries. */
void engine_load_chunk(int id, float* chunk_L, float* chunk_R,
                       long chunk_start, long chunk_length) {
    if (id < 0 || id >= MAX_TRACKS || !g_tracks[id].active) {
        /* Slot invalid — free the buffers so the caller doesn't leak them. */
        if (chunk_L) free(chunk_L);
        if (chunk_R) free(chunk_R);
        return;
    }
    Track* t = &g_tracks[id];
    long src_frame = g_playhead - t->start_frame;

    if (chunk_start <= src_frame) {
        /* Chunk covers current playhead — install immediately (seek / reload). */
        if (t->next_chunk_L) { free(t->next_chunk_L); t->next_chunk_L = NULL; }
        if (t->next_chunk_R) { free(t->next_chunk_R); t->next_chunk_R = NULL; }
        if (t->chunk_L) free(t->chunk_L);
        if (t->chunk_R) free(t->chunk_R);
        t->chunk_L      = chunk_L;
        t->chunk_R      = chunk_R;
        t->chunk_start  = chunk_start;
        t->chunk_length = chunk_length;
    } else {
        /* Future chunk — queue for seamless handover. */
        if (t->next_chunk_L) free(t->next_chunk_L);
        if (t->next_chunk_R) free(t->next_chunk_R);
        t->next_chunk_L      = chunk_L;
        t->next_chunk_R      = chunk_R;
        t->next_chunk_start  = chunk_start;
        t->next_chunk_length = chunk_length;
    }
}

/* Returns the number of source-file frames remaining before the furthest
   buffered chunk boundary (next_chunk if queued, otherwise current chunk).
   Reporting against next_chunk prevents the worklet from firing a redundant
   chunk_needed while a prefetch is already queued in the double buffer.
   Returns 0 if the slot is inactive or has no chunk loaded. */
long engine_chunk_remaining(int id, long playhead) {
    if (id < 0 || id >= MAX_TRACKS || !g_tracks[id].active || !g_tracks[id].chunk_L)
        return 0;
    Track* t = &g_tracks[id];
    long src_frame = playhead - t->start_frame;
    /* Report against next_chunk end if one is queued. */
    if (t->next_chunk_L) {
        long next_end = t->next_chunk_start + t->next_chunk_length;
        long remaining = next_end - src_frame;
        return remaining > 0 ? remaining : 0;
    }
    long chunk_end = t->chunk_start + t->chunk_length;
    long remaining = chunk_end - src_frame;
    return remaining > 0 ? remaining : 0;
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
