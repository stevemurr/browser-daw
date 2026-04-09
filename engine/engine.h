#ifndef ENGINE_H
#define ENGINE_H

/* Track lifecycle */
int  engine_add_track   (float* pcm_L, float* pcm_R,
                         long num_frames, float sample_rate);
void engine_remove_track(int track_id);
int  engine_get_track_count(void);

/* Per-track params */
void engine_set_gain       (int track_id, float gain);
void engine_set_pan        (int track_id, float pan);
void engine_set_mute       (int track_id, int muted);
void engine_set_solo       (int track_id, int soloed);
void engine_set_start_frame(int track_id, long start_frame);

/* Plugin params — plugin_id and param_id constants in plugin_ids.h */
void engine_plugin_set_param(int track_id, int plugin_id, int param_id, float value);

/* Transport */
void  engine_play    (void);
void  engine_pause   (void);
void  engine_seek    (long sample_position);
long  engine_get_playhead (void);
int   engine_is_playing   (void);

/* Master */
void engine_set_master_gain(float gain);

/* Called from AudioWorklet process() every 128 frames.
   output_L and output_R are float32 arrays of length `frames`. */
void engine_process(float* output_L, float* output_R, int frames);

/* Memory helpers exported to JS */
float* engine_alloc_pcm(long num_frames);
void   engine_free_pcm (float* ptr);

#endif
