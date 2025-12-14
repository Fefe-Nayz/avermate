import createNextIntlPlugin from 'next-intl/plugin';
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const withNextIntl = createNextIntlPlugin();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get git commit hash during build
function getGitCommitHash() {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch (error) {
    console.warn('Could not retrieve git commit hash:', error.message);
    return 'unknown';
  }
}

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
  env: {
    NEXT_PUBLIC_GIT_COMMIT_HASH: process.env.NEXT_PUBLIC_GIT_COMMIT_HASH || getGitCommitHash(),
  },
};

export default withNextIntl(nextConfig);
