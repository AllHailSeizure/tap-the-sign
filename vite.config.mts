import { devvit } from '@devvit/start/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [devvit()],
  build: {
    assetsInlineLimit: 512 * 1024,
  },
});
