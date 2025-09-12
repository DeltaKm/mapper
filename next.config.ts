import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Aumenta timeout per API routes pesanti
    serverComponentsExternalPackages: ['prisma'],
  },
  // Timeout esteso per operazioni lunghe
  api: {
    responseLimit: false,
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

export default nextConfig;
