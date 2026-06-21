/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // Lint is run separately; don't block production builds on it.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
