import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The LINE webhook must read the raw request body to verify the signature,
  // so it has to run on Node.js rather than the edge runtime.
  serverExternalPackages: ["unpdf"],
  // There is another lockfile in the user's home directory, which Next would
  // otherwise pick as the workspace root and resolve paths against.
  turbopack: { root: path.resolve(".") },
  // TypeScript 7 is the native compiler and no longer exposes the JS compiler
  // API Next reaches for by default; the CLI path works with it.
  experimental: { useTypeScriptCli: true },
};

export default nextConfig;
