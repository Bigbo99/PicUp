import type { NextConfig } from 'next';
import path from 'node:path';
import { networkInterfaces } from 'node:os';

// pnpm's Windows symlink layout cannot be copied into Next's standalone
// trace directory without Developer Mode/admin privileges. Docker/Linux
// builds keep standalone output; local Windows builds use the normal server.
const standaloneOutput = process.env.NEXT_DISABLE_STANDALONE !== '1' && process.platform !== 'win32';

const nextConfig: NextConfig = {
  devIndicators: false,
  // Allow development access from computers on the local network.
  allowedDevOrigins: ['localhost', '127.0.0.1', ...Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((address) => address.family === 'IPv4' && !address.internal)
    .map((address) => address.address)],
  distDir: process.env.NEXT_DIST_DIR || '.next',
  ...(standaloneOutput
    ? {
        output: 'standalone' as const,
        outputFileTracingRoot: path.join(process.cwd(), '../..')
      }
    : {}),
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: '**' },
      { protocol: 'https', hostname: '**' }
    ]
  },
  async headers() {
    const noStoreHeaders = [
      {
        key: 'Cache-Control',
        value: 'private, no-cache, no-store, max-age=0, must-revalidate'
      }
    ];

    return [
      {
        source: '/api/image/jobs/:id/preview/:index',
        headers: [{ key: 'Cache-Control', value: 'private, max-age=86400, immutable' }]
      },
      // App HTML and RSC payloads reference deploy-specific chunk hashes.
      // They must not outlive the static files from the same deployment.
      {
        source: '/:path((?!_next/static/).*)',
        headers: noStoreHeaders
      },
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable'
          }
        ]
      }
    ];
  },
  async rewrites() {
    // 本地 dev: http://localhost:4000
    // Docker Compose: http://api:4000 (通过 .env 或 docker-compose.yml 设置)
    // 生产环境: Nginx 直接分流，这些 rewrites 不会被触发
    const apiUrl = process.env.API_INTERNAL_URL || (process.env.NODE_ENV === 'production' ? 'http://api:4000' : 'http://localhost:4318');
    console.log('[DEBUG] Next.js Rewrites: Using API URL:', apiUrl);
    return [
      { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
      { source: '/media/:path*', destination: `${apiUrl}/media/:path*` }
    ];
  }
};

export default nextConfig;
