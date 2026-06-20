// Proxy that redirects @aws-sdk/client-s3's Node runtimeConfig to the browser
// version so Cloudflare Workers uses FetchHttpHandler instead of NodeHttpHandler
// and avoids fs.readFile (which is not implemented in Workers).
export { getRuntimeConfig } from '@aws-sdk/client-s3/dist-es/runtimeConfig.browser.js';
