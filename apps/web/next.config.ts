import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost', port: '4000', pathname: '/media/**' },
      { protocol: 'https', hostname: '**' }
    ]
  }
};

export default nextConfig;
