#ifndef DISTORTION_H
#define DISTORTION_H

typedef struct {
    int   enabled;
    float drive;       /* 0-100 */
    float mode;        /* 0=soft(tanh), 1=hard clip, 2=fuzz(asymmetric) */
    float mix;         /* 0-100 wet/dry */
} Distortion;

void distortion_init      (Distortion* d);
void distortion_set_param (Distortion* d, int param_id, float value);
void distortion_process   (Distortion* d, float in_L, float in_R,
                           float* out_L, float* out_R);

#endif
