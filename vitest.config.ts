import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    globals: false,
    testTimeout: 60_000,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["contracts/**", "node_modules/**", "scripts/**"],
  },
});
