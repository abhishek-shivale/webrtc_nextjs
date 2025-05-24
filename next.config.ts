import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.*"],

  async headers() {
    return [
      {
        source: '/hls/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, OPTIONS',
          },
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
          {
            key: 'Content-Type',
            value: 'application/vnd.apple.mpegurl',
          },
        ],
      },
      {
        source: '/hls/:path*.ts',
        headers: [
          {
            key: 'Content-Type',
            value: 'video/mp2t',
          },
        ],
      },
    ];
  },
  
  async rewrites() {
    return [
      {
        source: '/hls/:path*',
        destination: '/api/hls/:path*',
      },
    ];
  },

};

export default nextConfig;