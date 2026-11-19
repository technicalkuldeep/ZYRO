import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
  {
    ignores: [
      "**/.next/**",
      "**/.next-qa/**",
      "**/.next-qa6/**",
      "**/node_modules/**",
      "**/next-env.d.ts",
      // Integrity-verified upstream artifacts; never rewrite generated WASM bindings.
      "apps/web/public/zcash-wallet/engine/**",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        fetch: "readonly",
        setInterval: "readonly",
      },
    },
  },
);
