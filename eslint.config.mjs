import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["components/**/*.{ts,tsx}", "features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@/server/*", "@/db/*", "@/app/api/*"],
          message: "Client-facing modules must call APIs or shared contracts, not server/database internals.",
        }],
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    ".tools/**",
    "target/**",
    ".wrangler/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
