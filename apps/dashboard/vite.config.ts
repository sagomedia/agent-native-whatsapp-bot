import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({ root: resolve('apps/dashboard'), build: { outDir: resolve('dist/dashboard'), emptyOutDir: true }, esbuild: { jsx: 'automatic' } });
