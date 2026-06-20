/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    user?: {
      id: string;
      username: string;
      role: string;
    };
  }
}

declare module 'cloudflare:workers' {
  interface Env {
    DB: import("@cloudflare/workers-types").D1Database;
    JWT_SECRET?: string;
    TURNSTILE_SECRET_KEY?: string;
    INVITE_ONLY?: string;
    INVITE_CODE?: string;
    
    // S3 configuration
    S3_ENDPOINT_URL?: string;
    S3_SECRET_ACCESS_KEY?: string;
    S3_ACCESS_KEY_ID?: string;
    S3_BUCKET_NAME?: string;
    S3_REGION_NAME?: string;
  }
  export const env: Env;
}
