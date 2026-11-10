import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",               // small self-contained server for Docker
  serverExternalPackages: ["pg"],
  outputFileTracingIncludes: { "/**": ["./eval/results.json"] },
};

export default config;
