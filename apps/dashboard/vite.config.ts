import {defineConfig} from 'vite';
import {resolve} from 'node:path';

const root = resolve('apps/dashboard');

export default defineConfig({
  root,
  build: {
    outDir: resolve('dist/dashboard'),
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        index: resolve(root, 'index.html'),
        'owner-startup': resolve(root, 'src/owner-startup-entry.ts'),
      },
    },
  },
  esbuild: {jsx: 'automatic'},
  plugins: [{
    name: 'shopbot-owner-startup',
    transformIndexHtml: {
      order: 'post',
      handler(_html, {bundle}) {
        const startup = Object.values(bundle ?? {}).find(file =>
          file.type === 'chunk' && file.isEntry && file.name === 'owner-startup');
        if (!startup) return;
        return [{tag: 'script', attrs: {type: 'module', async: true, src: '/' + startup.fileName}, injectTo: 'head-prepend'}];
      },
    },
  }],
});
