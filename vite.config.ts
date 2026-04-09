import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // COOP/COEP headers were removed: we do not use SharedArrayBuffer, so the
  // isolation they provide is unnecessary — and COEP 'require-corp' caused
  // Chrome to silently drop postMessage payloads containing WebAssembly.Module
  // when sent to AudioWorkletNode.port, preventing worklet initialisation.
});
