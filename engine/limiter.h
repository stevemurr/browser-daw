#ifndef LIMITER_H
#define LIMITER_H

typedef struct {
    int   enabled;
    float threshold_db;   /* -24 to 0 dBFS */
    float release_ms;     /* 10-500 ms */
    float gain_lin;       /* current gain reduction multiplier */
    float rel_coeff;      /* per-sample release coefficient */
    float sample_rate;
} Limiter;

void limiter_init      (Limiter* l, float sample_rate);
void limiter_set_param (Limiter* l, int param_id, float value);
void limiter_process   (Limiter* l, float in_L, float in_R,
                        float* out_L, float* out_R);
void limiter_reset     (Limiter* l);

#endif
