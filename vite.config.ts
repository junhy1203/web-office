import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), {
    name: 'local-hangul-core',
    enforce: 'pre',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/@rhwp/core/rhwp.js')) return;
      return source.replace(/new URL\(['"]rhwp_bg\.wasm['"], import\.meta\.url\)/g, "new URL('/rhwp/core.wasm.pack', location.href)");
    },
  }],
  optimizeDeps: { exclude: ['@rhwp/core'] },
  resolve: { alias: { buffer: 'buffer/', string_decoder: 'string_decoder/' } },
  server: { host: '127.0.0.1' },
  build: { target: 'es2022' },
});
