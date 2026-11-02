import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  outputFileTracingExcludes: { "*": ["./media/**", "./out/**", "./screenshots/**", "./data/**"] },
};
export default nextConfig;
