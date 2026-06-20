// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cloudflare Workers runs in a Node-compatible env (nodejs_compat flag).
// However, Vite resolves browser bundles for @smithy/* and @aws-sdk/* packages
// which stub Node-only exports as Symbol.for("node-only") — causing runtime
// errors like "loadConfig is not a function" or "emitWarningIfUnsupportedVersion
// is not a function". We alias all affected submodule browser entrypoints back
// to their full Node implementations.
const smithyCoreBase = './node_modules/@smithy/core/dist-es/submodules';
const awsSdkCoreBase = './node_modules/@aws-sdk/core/dist-es/submodules';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  vite: {
    resolve: {
      alias: {
        // @aws-sdk/core/client browser stub → our no-op mock (already existed)
        '@aws-sdk/core/client': path.resolve(__dirname, './src/utils/aws-core-client-mock.js'),

        // @smithy/core submodules: force Node index instead of browser stub
        '@smithy/core/config': path.resolve(__dirname, `${smithyCoreBase}/config/index.js`),
        '@smithy/core/checksum': path.resolve(__dirname, `${smithyCoreBase}/checksum/index.js`),
        '@smithy/core/retry': path.resolve(__dirname, `${smithyCoreBase}/retry/index.js`),
        '@smithy/core/serde': path.resolve(__dirname, `${smithyCoreBase}/serde/index.js`),
        '@smithy/core/event-streams': path.resolve(__dirname, `${smithyCoreBase}/event-streams/index.js`),
      },
    },
    // Ensure these packages are bundled server-side (not pre-optimized as browser deps)
    ssr: {
      noExternal: ['@aws-sdk/client-s3', '@aws-sdk/core', '@smithy/core'],
    },
  },
});
