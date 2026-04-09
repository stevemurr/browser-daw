/**
 * Isolated engine test — verifies HEAPF32 pointer math and core engine logic
 * before wiring up React / AudioWorklet.
 *
 * Build first:  cd engine && ./build_test.sh
 * Run:          node test/engine_test.mjs
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const modulePath = path.join(__dirname, 'audio_engine_node.js');
const AudioEngineModule = require(modulePath);

async function main() {
  const M = await AudioEngineModule();

  const FRAMES = 128;

  // ── Helper: allocate a float32 output buffer in WASM heap ──────────────────
  // engine_alloc_pcm returns a BYTE offset into M.HEAPF32.buffer.
  // HEAPF32 indices are byte_offset >> 2.
  function allocF32(frames) {
    const bytePtr = M._engine_alloc_pcm(frames);
    if (bytePtr === 0) throw new Error('engine_alloc_pcm returned NULL');
    return bytePtr;
  }

  function heapSlice(bytePtr, frames) {
    const idx = bytePtr >> 2;
    return M.HEAPF32.subarray(idx, idx + frames);
  }

  // ── Test 1: silent output when engine is paused ───────────────────────────
  console.log('\n[Test 1] engine_process with no tracks, paused → expect all zeros');

  const outPtrL = allocF32(FRAMES);
  const outPtrR = allocF32(FRAMES);

  // Zero the output buffers first (engine should overwrite them anyway)
  heapSlice(outPtrL, FRAMES).fill(1.0);  // pre-fill with 1 to confirm overwrite
  heapSlice(outPtrR, FRAMES).fill(1.0);

  M._engine_process(outPtrL, outPtrR, FRAMES);

  const L1 = heapSlice(outPtrL, FRAMES);
  const R1 = heapSlice(outPtrR, FRAMES);

  const allZeroL = Array.from(L1).every(v => v === 0.0);
  const allZeroR = Array.from(R1).every(v => v === 0.0);

  console.log(`  L[0..4]: [${Array.from(L1.subarray(0, 4)).map(v => v.toFixed(6)).join(', ')}]`);
  console.log(`  R[0..4]: [${Array.from(R1.subarray(0, 4)).map(v => v.toFixed(6)).join(', ')}]`);
  console.log(`  All zeros (L): ${allZeroL} ✓`);
  console.log(`  All zeros (R): ${allZeroR} ✓`);

  if (!allZeroL || !allZeroR) {
    throw new Error('FAIL: expected silence when paused');
  }

  // ── Test 2: add a silent track, play → expect zero output ────────────────
  console.log('\n[Test 2] add silent track, play → tanh(0) = 0');

  const NUM_FRAMES_PCM = 1024;
  const pcmPtrL = allocF32(NUM_FRAMES_PCM);
  const pcmPtrR = allocF32(NUM_FRAMES_PCM);

  // Fill with silence
  heapSlice(pcmPtrL, NUM_FRAMES_PCM).fill(0.0);
  heapSlice(pcmPtrR, NUM_FRAMES_PCM).fill(0.0);

  // engine_add_track copies the PCM internally; pcmPtr* can be freed after
  const trackId = M._engine_add_track(pcmPtrL, pcmPtrR, NUM_FRAMES_PCM, 44100.0);
  M._engine_free_pcm(pcmPtrL);
  M._engine_free_pcm(pcmPtrR);

  console.log(`  track_id: ${trackId}`);
  if (trackId < 0) throw new Error('FAIL: engine_add_track returned -1');

  M._engine_play();
  console.log(`  is_playing: ${M._engine_is_playing()}`);

  heapSlice(outPtrL, FRAMES).fill(9.0);
  heapSlice(outPtrR, FRAMES).fill(9.0);

  M._engine_process(outPtrL, outPtrR, FRAMES);

  const L2 = heapSlice(outPtrL, FRAMES);
  const R2 = heapSlice(outPtrR, FRAMES);

  console.log(`  L[0..4]: [${Array.from(L2.subarray(0, 4)).map(v => v.toFixed(6)).join(', ')}]`);
  console.log(`  R[0..4]: [${Array.from(R2.subarray(0, 4)).map(v => v.toFixed(6)).join(', ')}]`);

  const allZeroL2 = Array.from(L2).every(v => Math.abs(v) < 1e-7);
  const allZeroR2 = Array.from(R2).every(v => Math.abs(v) < 1e-7);
  console.log(`  Near-zero (L): ${allZeroL2} ✓`);
  console.log(`  Near-zero (R): ${allZeroR2} ✓`);
  if (!allZeroL2 || !allZeroR2) throw new Error('FAIL: silent track should produce silent output');

  // ── Test 3: playhead advances ─────────────────────────────────────────────
  console.log('\n[Test 3] playhead advances by FRAMES after engine_process');

  M._engine_seek(0);
  M._engine_process(outPtrL, outPtrR, FRAMES);
  const ph = M._engine_get_playhead();
  console.log(`  playhead after one block: ${ph} (expected ${FRAMES})`);
  if (ph !== FRAMES) throw new Error(`FAIL: playhead=${ph}, expected ${FRAMES}`);

  // ── Test 4: non-zero PCM passes through ───────────────────────────────────
  console.log('\n[Test 4] non-zero PCM track → non-zero output');

  M._engine_remove_track(trackId);
  M._engine_seek(0);

  const pcmPtrL2 = allocF32(NUM_FRAMES_PCM);
  const pcmPtrR2 = allocF32(NUM_FRAMES_PCM);

  // Fill with 0.5 signal
  heapSlice(pcmPtrL2, NUM_FRAMES_PCM).fill(0.5);
  heapSlice(pcmPtrR2, NUM_FRAMES_PCM).fill(0.5);

  const trackId2 = M._engine_add_track(pcmPtrL2, pcmPtrR2, NUM_FRAMES_PCM, 44100.0);
  M._engine_free_pcm(pcmPtrL2);
  M._engine_free_pcm(pcmPtrR2);

  M._engine_process(outPtrL, outPtrR, FRAMES);

  const L4 = heapSlice(outPtrL, FRAMES);
  const R4 = heapSlice(outPtrR, FRAMES);

  console.log(`  L[0..4]: [${Array.from(L4.subarray(0, 4)).map(v => v.toFixed(6)).join(', ')}]`);
  console.log(`  R[0..4]: [${Array.from(R4.subarray(0, 4)).map(v => v.toFixed(6)).join(', ')}]`);

  // With 0.5 input, pan=0 (center), gain=1, master=1:
  // pan_angle = (0+1)*0.25*pi = pi/4  → cos(pi/4) = sin(pi/4) ≈ 0.7071
  // output ≈ tanh(0.5 * 0.7071) ≈ tanh(0.3536) ≈ 0.3412
  const expectedApprox = Math.tanh(0.5 * Math.cos(Math.PI / 4));
  console.log(`  Expected approx: ${expectedApprox.toFixed(6)}`);
  const nonZero = Array.from(L4).some(v => Math.abs(v) > 0.1);
  if (!nonZero) throw new Error('FAIL: expected non-zero output for non-zero PCM');
  console.log(`  Non-zero output confirmed ✓`);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  M._engine_free_pcm(outPtrL);
  M._engine_free_pcm(outPtrR);
  M._engine_remove_track(trackId2);

  console.log('\n✓ All tests passed — engine + HEAPF32 pointer math OK\n');
}

main().catch(err => {
  console.error('\n✗ Test FAILED:', err.message);
  process.exit(1);
});
