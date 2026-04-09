#ifndef PLUGIN_IDS_H
#define PLUGIN_IDS_H

/* ── Plugin IDs (plugin_id argument to engine_plugin_set_param) ── */
#define PLUGIN_EQ          0
#define PLUGIN_COMPRESSOR  1
#define PLUGIN_DISTORTION  2
#define PLUGIN_LIMITER     3
#define PLUGIN_DELAY       4
#define PLUGIN_CHORUS      5
#define PLUGIN_REVERB      6

/* ── Compressor param IDs ── */
#define COMP_PARAM_ENABLED  0
#define COMP_PARAM_AMOUNT   1

/* ── Distortion param IDs ── */
#define DIST_PARAM_ENABLED  0
#define DIST_PARAM_DRIVE    1
#define DIST_PARAM_MODE     2
#define DIST_PARAM_MIX      3

/* ── Limiter param IDs ── */
#define LIM_PARAM_ENABLED   0
#define LIM_PARAM_THRESHOLD 1
#define LIM_PARAM_RELEASE   2

/* ── Delay param IDs ── */
#define DELAY_PARAM_ENABLED  0
#define DELAY_PARAM_TIME_MS  1
#define DELAY_PARAM_FEEDBACK 2
#define DELAY_PARAM_MIX      3

/* ── Chorus param IDs ── */
#define CHORUS_PARAM_ENABLED 0
#define CHORUS_PARAM_RATE    1
#define CHORUS_PARAM_DEPTH   2
#define CHORUS_PARAM_MIX     3

/* ── Reverb param IDs ── */
#define REV_PARAM_ENABLED    0
#define REV_PARAM_PRESET     1
#define REV_PARAM_MIX        2

/* ── EQ param IDs (param_id when plugin_id == PLUGIN_EQ) ── */
#define EQ_PARAM_ENABLED     0   /* global EQ bypass: 0.0=off 1.0=on  */
#define EQ_PARAM_BAND0_FREQ  1   /* Low shelf frequency  (Hz)          */
#define EQ_PARAM_BAND0_GAIN  2   /* Low shelf gain       (dB)          */
#define EQ_PARAM_BAND0_Q     3   /* Low shelf Q                        */
#define EQ_PARAM_BAND1_FREQ  4   /* Mid peak frequency   (Hz)          */
#define EQ_PARAM_BAND1_GAIN  5   /* Mid peak gain        (dB)          */
#define EQ_PARAM_BAND1_Q     6   /* Mid peak Q                         */
#define EQ_PARAM_BAND2_FREQ  7   /* High shelf frequency (Hz)          */
#define EQ_PARAM_BAND2_GAIN  8   /* High shelf gain      (dB)          */
#define EQ_PARAM_BAND2_Q     9   /* High shelf Q                       */

#endif
