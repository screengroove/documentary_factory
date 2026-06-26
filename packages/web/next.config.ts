import type { NextConfig } from "next";
import { join } from "node:path";

// Next.js only auto-loads .env from packages/web, but our secrets live in the
// repo-root .env (see Global Constraints). Load it explicitly so realDeps()
// sees ANTHROPIC_API_KEY / REPLICATE_API_TOKEN at runtime.
// process.loadEnvFile requires Node >= 20.12; it throws if the file is absent,
// which is fine in CI where the vars are already in the environment.
try {
  process.loadEnvFile(join(process.cwd(), "..", "..", ".env"));
} catch {
  // No root .env present — rely on whatever is already in process.env.
}

const config: NextConfig = {
  typescript: { ignoreBuildErrors: false },
  // @doc/core ships raw TS (its package.json "main" is ./src/index.ts) using
  // ESM ".js" import specifiers that resolve to ".ts" files. transpilePackages
  // makes SWC compile the workspace package; extensionAlias makes webpack resolve
  // those ".js" specifiers to the actual ".ts"/".tsx" source files.
  transpilePackages: ["@doc/core"],
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    },
  },
};
export default config;
