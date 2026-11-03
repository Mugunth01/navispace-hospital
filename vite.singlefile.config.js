import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// npm run build:singlefile -> dist-singlefile/index.html
// A fully self-contained page (no CDN, no separate JS/CSS files) — handy for
// emailing a demo or dropping into a sandbox that has no dev server.
export default defineConfig({
  plugins: [viteSingleFile()],
  esbuild: { charset: 'ascii' },   // escape non-ASCII (Tamil, symbols) so the page works under any charset
  build: {
    outDir: 'dist-singlefile',
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
