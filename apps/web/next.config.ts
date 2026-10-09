import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Hide the built-in Next.js dev indicator (bottom-left "N" badge).
  // Official config option — no CSS hiding. Compile/runtime errors still surface.
  devIndicators: false,
};

export default nextConfig;
