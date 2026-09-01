import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { fileURLToPath } from 'node:url';
import { paramsWriteback } from './writeback.js';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // paramsWriteback lets the panel save knob values into the scene file and
  // runs the gate on what it wrote — see writeback.js for why that is the
  // point rather than a convenience. It is `apply: 'serve'`, so it exists
  // only while `pnpm inspect` is running.
  plugins: [react(), paramsWriteback()],
  server: { port: 5180, open: true },
  resolve: { dedupe: ['three', 'react', 'react-dom'] },
});
