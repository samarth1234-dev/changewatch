const path = require('node:path');

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL || 'http://127.0.0.1:3001';

/** @type {import('next').NextConfig} */
module.exports = {
  outputFileTracingRoot: path.join(__dirname),
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${BACKEND_URL}/api/:path*`,
      },
      {
        source: '/health',
        destination: `${BACKEND_URL}/health`,
      },
      {
        source: '/screenshots/:path*',
        destination: `${BACKEND_URL}/screenshots/:path*`,
      },
    ];
  },
};
