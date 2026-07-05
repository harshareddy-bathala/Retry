// Shared flat ESLint base. Apps extend this and add environment-specific rules.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "coverage/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Hard Rule 1 — `any` is banned
      "@typescript-eslint/no-explicit-any": "error",
      // Hard Rule 10 — use the logger, not console (apps/web overrides for dev warnings)
      "no-console": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ]
    }
  }
);
