/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    runtime: {
      env: {
        DB: import("@cloudflare/workers-types").D1Database;
        R2: import("@cloudflare/workers-types").R2Bucket;
        JWT_SECRET?: string;
        TURNSTILE_SECRET_KEY?: string;
        INVITE_ONLY?: string;
        INVITE_CODE?: string;
      };
      cf: import("@cloudflare/workers-types").CfProperties;
      ctx: import("@cloudflare/workers-types").ExecutionContext;
    };
    user?: {
      id: string;
      username: string;
      role: string;
    };
  }
}
