// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Strategy for running @aws-sdk/client-s3 in Cloudflare Workers:
//
// Problem 1: @aws-sdk/core/client browser bundle exports emitWarningIfUnsupportedVersion
//   as Symbol.for("node-only") → calling it throws "not a function".
//   Fix: alias to our no-op mock.
//
// Problem 2: Vite SSR ignores package.json "browser" field overrides, so it bundles
//   S3Client's NODE runtimeConfig which calls loadConfig() and reads ~/.aws/config
//   via fs.readFile → "[unenv] fs.readFile is not implemented yet!"
//   Fix: Vite plugin that intercepts the runtimeConfig import and redirects to browser.
//
// The browser runtimeConfig uses:
//   - FetchHttpHandler (fetch-based) instead of NodeHttpHandler ✓
//   - WebCrypto SHA256 instead of Node crypto ✓
//   - resolveDefaultsModeConfig (no fs) instead of loadConfig ✓

/** @returns {import('vite').Plugin} */
function awsSdkBrowserRuntimePlugin() {
  const nodeRuntimeConfigPath = path.resolve(
    __dirname,
    'node_modules/@aws-sdk/client-s3/dist-es/runtimeConfig.js'
  );
  const browserRuntimeConfigPath = path.resolve(
    __dirname,
    'node_modules/@aws-sdk/client-s3/dist-es/runtimeConfig.browser.js'
  );

  return {
    name: 'aws-sdk-browser-runtime',
    enforce: 'pre',
    resolveId(id, importer) {
      // Intercept the runtimeConfig import from within S3Client
      if (id.includes('runtimeConfig') && !id.includes('.browser') && importer?.includes('@aws-sdk/client-s3')) {
        return browserRuntimeConfigPath;
      }
      // Also handle the direct path being resolved
      if (id === nodeRuntimeConfigPath || id === './runtimeConfig' && importer?.includes('@aws-sdk/client-s3')) {
        return browserRuntimeConfigPath;
      }
      return null;
    },
  };
}

export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  vite: {
    plugins: [awsSdkBrowserRuntimePlugin()],
    resolve: {
      alias: {
        // Turn emitWarningIfUnsupportedVersion Symbol stub → no-op function
        '@aws-sdk/core/client': path.resolve(__dirname, './src/utils/aws-core-client-mock.js'),
      },
    },
  },
});
