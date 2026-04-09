#ifndef DELAY_H
#define DELAY_H

#define DELAY_MAX_SAMPLES 88200  /* 2 seconds at 44100 Hz */

typedef struct {
    int   enabled;
    float time_ms;      /* 1-2000 */
    float feedback;     /* 0-0.95 (stored as fraction internally) */
    float mix;          /* 0-1 wet fraction internally */

    float* buf_L;       /* circular buffer left  (malloc'd DELAY_MAX_SAMPLES) */
    float* buf_R;       /* circular buffer right */
    int    write_pos;   /* current write index */
    int    buf_size;    /* DELAY_MAX_SAMPLES */
    float  sample_rate;
} Delay;

void delay_init      (Delay* d, float sample_rate);
void delay_set_param (Delay* d, int param_id, float value);
void delay_process   (Delay* d, float in_L, float in_R,
                      float* out_L, float* out_R);
void delay_reset     (Delay* d);
void delay_free      (Delay* d);

#endif
