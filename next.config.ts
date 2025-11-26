import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  // Enable TypeScript strict mode
  typescript: {
    ignoreBuildErrors: false,
  },
  // ESLint configuration
  eslint: {
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
