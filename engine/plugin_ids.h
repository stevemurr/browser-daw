#ifndef PLUGIN_IDS_H
#define PLUGIN_IDS_H

/* ── Plugin IDs (plugin_id argument to engine_plugin_set_param) ── */
#define PLUGIN_EQ  0
/* future: #define PLUGIN_COMPRESSOR  1 */

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
