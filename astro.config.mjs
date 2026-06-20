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
      // Only redirect the EXACT runtimeConfig entry point — not .shared, .browser, etc.
      // Matching too broadly caused circular redirects (stack overflow).
      const isExactRuntimeConfig =
        id === './runtimeConfig' ||
        id === nodeRuntimeConfigPath ||
        id.endsWith('/runtimeConfig') ||
        id.endsWith('/runtimeConfig.js');

      const isNotAlreadyBrowser =
        !id.includes('.browser') && !id.includes('.shared') && !id.includes('.native');

      const isFromS3Client = importer?.includes('@aws-sdk/client-s3');

      if (isExactRuntimeConfig && isNotAlreadyBrowser && isFromS3Client) {
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
