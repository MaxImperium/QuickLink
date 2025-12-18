/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@quicklink/shared"],
  // Enable standalone output for Docker deployments
  output: "standalone",
  // Experimental features for future optimizations
  experimental: {
    // instrumentationHook: true,
  },
};

module.exports = nextConfig;
