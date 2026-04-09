#ifndef CHORUS_H
#define CHORUS_H

#define CHORUS_BUF_SIZE 8192  /* ~185 ms at 44100 Hz — more than enough */

typedef struct {
    int   enabled;
    float rate;          /* LFO rate in Hz (0.1-5.0) */
    float depth;         /* 0-1 (stored as fraction; depth=1 → max 20ms swing) */
    float mix;           /* 0-1 wet fraction */

    float buf_L[CHORUS_BUF_SIZE];
    float buf_R[CHORUS_BUF_SIZE];
    int   write_pos;

    float lfo_phase;     /* 0 to 2*PI */
    float lfo_inc;       /* per-sample phase increment */
    float sample_rate;
} Chorus;

void chorus_init      (Chorus* c, float sample_rate);
void chorus_set_param (Chorus* c, int param_id, float value);
void chorus_process   (Chorus* c, float in_L, float in_R,
                       float* out_L, float* out_R);
void chorus_reset     (Chorus* c);
#endif
