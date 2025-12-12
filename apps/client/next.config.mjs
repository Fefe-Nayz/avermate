import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Ensure Turbopack resolves the workspace root (node_modules at /app)
  experimental: {
    turbopack: {
      // point to the workspace root from the project dir so Next is resolvable
      root: "../../",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatar.vercel.sh",
      },
    ],
  },
};

export default withNextIntl(nextConfig);
