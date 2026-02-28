import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/routes/**/*.ts"],
  format: ["esm"],
  outDir: "dist",
  platform: "node",
  sourcemap: false,
  clean: true,
  dts: false,
  target: false,
});
