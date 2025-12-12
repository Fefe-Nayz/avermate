import createNextIntlPlugin from 'next-intl/plugin';
import path from "path";
import { fileURLToPath } from "url";

const withNextIntl = createNextIntlPlugin();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  turbopack: {
    // monorepo root (=> includes /app/node_modules in Docker)
    root: path.join(__dirname, "../.."),
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
