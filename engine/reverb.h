#ifndef REVERB_H
#define REVERB_H

#define REV_COMB_COUNT   8
#define REV_ALLPASS_COUNT 4

/* Comb filter delay lengths (samples at 44100 Hz) — stereo spread via +23 for R channel */
#define REV_COMB_L_0  1116
#define REV_COMB_L_1  1188
#define REV_COMB_L_2  1277
#define REV_COMB_L_3  1356
#define REV_COMB_L_4  1422
#define REV_COMB_L_5  1491
#define REV_COMB_L_6  1557
#define REV_COMB_L_7  1617
#define REV_COMB_SPREAD 23

/* Allpass delay lengths */
#define REV_AP_L_0  556
#define REV_AP_L_1  441
#define REV_AP_L_2  341
#define REV_AP_L_3  225

/* Max buffer sizes (add spread) */
#define REV_COMB_MAX  (1617 + 23 + 4)
#define REV_AP_MAX    (556 + 4)

typedef struct {
    float buf[REV_COMB_MAX];
    int   size;
    int   pos;
    float filter_state;   /* low-pass filter state */
} CombFilter;

typedef struct {
    float buf[REV_AP_MAX];
    int   size;
    int   pos;
} AllpassFilter;

typedef struct {
    int   enabled;
    float preset;    /* 0=room, 1=hall, 2=non-lin */
    float mix;       /* 0-1 */

    /* Left / Right comb and allpass banks */
    CombFilter    combs_L[REV_COMB_COUNT];
    CombFilter    combs_R[REV_COMB_COUNT];
    AllpassFilter aps_L[REV_ALLPASS_COUNT];
    AllpassFilter aps_R[REV_ALLPASS_COUNT];

    /* Current reverb parameters (derived from preset) */
    float feedback;   /* comb feedback (room time) */
    float damping;    /* comb low-pass damping     */
} Reverb;

void reverb_init      (Reverb* r, float sample_rate);
void reverb_set_param (Reverb* r, int param_id, float value);
void reverb_process   (Reverb* r, float in_L, float in_R,
                       float* out_L, float* out_R);
void reverb_reset     (Reverb* r);
#endif
