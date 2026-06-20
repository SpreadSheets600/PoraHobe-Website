// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  vite: {
    resolve: {
      alias: {
        '@aws-sdk/core/client': path.resolve(__dirname, './src/utils/aws-core-client-mock.js'),
      },
    },
  },
});
