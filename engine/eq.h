#ifndef EQ_H
#define EQ_H

typedef struct {
    float b0, b1, b2, a1, a2;
    float x1, x2, y1, y2;
} Biquad;

typedef enum {
    BAND_LOW_SHELF  = 0,
    BAND_MID_PEAK   = 1,
    BAND_HIGH_SHELF = 2
} BandType;

typedef struct {
    Biquad filters[2]; /* one per channel: L and R */
    float  freq;
    float  gain_db;
    float  q;
    int    enabled;
    BandType type;
} EQBand;

typedef struct {
    EQBand bands[3];
    int    enabled;
} TrackEQ;

void  biquad_set_lowshelf (Biquad* f, float freq, float gain_db, float q, float sr);
void  biquad_set_highshelf(Biquad* f, float freq, float gain_db, float q, float sr);
void  biquad_set_peak     (Biquad* f, float freq, float gain_db, float q, float sr);
float biquad_process      (Biquad* f, float x);
void  biquad_reset        (Biquad* f);

void  eq_init    (TrackEQ* eq, float sample_rate);
void  eq_set_band(TrackEQ* eq, int band, BandType type,
                  float freq, float gain_db, float q, float sample_rate);
float eq_process_sample(TrackEQ* eq, float sample, int channel);

/* Generic param setter — param_id values defined in plugin_ids.h */
void  eq_set_param(TrackEQ* eq, int param_id, float value, float sample_rate);

#endif
