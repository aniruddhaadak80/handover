import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships a Postgres WASM bundle plus its data files. Bundling it breaks
  // `instantiateWasm`, so it is required from node_modules at runtime instead.
  // Production uses Neon and never touches this package.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;