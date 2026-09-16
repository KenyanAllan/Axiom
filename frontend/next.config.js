/** @type {import('next').NextConfig} */
const nextConfig = {
  // Proxy API calls to the FastAPI backend in dev
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8000/api/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
