import { build } from "esbuild"

await build({
  entryPoints: ["src/index.tsx"],
  bundle: true,
  format: "esm",
  outfile: "dist/index.js",
  jsx: "automatic",
  jsxImportSource: "@opentui/solid",
  external: ["@opentui/solid/jsx-runtime", "@opencode-ai/plugin", "solid-js", "node:fs", "node:path", "node:os"],
  target: "esnext",
  sourcemap: true,
  logLevel: "info",
})

console.log("built dist/index.js")