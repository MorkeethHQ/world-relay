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
    // e2e-api.test.ts hits the live Anthropic API and is gated INSIDE the file
    // (E2E_LIVE_API=1), not excluded here — an exclude would also swallow it when
    // run by name, so the opt-in command would match zero tests and still say green.
    exclude: ["contracts/**", "node_modules/**", "scripts/**"],
  },
});
