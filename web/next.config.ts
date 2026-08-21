import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The repo root also has a package-lock.json (the Redocly contract tooling),
  // so Next would otherwise guess the workspace root one level up and trace
  // files that are not part of this app.
  outputFileTracingRoot: path.join(__dirname),

  // The spec is read from Postgres per request; nothing here may be cached in
  // the client router or an approved edit would not appear until a reload.
  experimental: { staleTimes: { dynamic: 0, static: 0 } },
};

export default nextConfig;
