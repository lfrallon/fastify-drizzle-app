import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts", // main server entry
    "src/routes/**/*.ts", // compile all route files
  ],
  outDir: "dist",
  format: ["esm"], // ESM for Node
  sourcemap: true,
  clean: true,
  splitting: false, // disable code splitting for Node backend
  esbuildOptions(options) {
    options.platform = "node";
  },
});
