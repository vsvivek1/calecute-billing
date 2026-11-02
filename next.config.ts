import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `postgres` opens raw sockets; it must not be bundled.
  serverExternalPackages: ["postgres"],
  poweredByHeader: false,
};

export default nextConfig;
