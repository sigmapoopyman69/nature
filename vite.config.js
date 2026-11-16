import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);
// The published controller package does not expose its source-tree /path
// export in every release, so resolve its installed module directory.
const controllerPath = dirname(
  require.resolve("@mercuryworkshop/scramjet-controller")
);
const libcurlPath = dirname(
  require.resolve("@mercuryworkshop/libcurl-transport")
);

export default defineConfig({
  base: "/nature/",
  plugins: [
    viteStaticCopy({
      targets: [
        { src: `${scramjetPath}/*`, dest: "scramjet" },
        { src: `${controllerPath}/*`, dest: "controller" },
        { src: `${libcurlPath}/*`, dest: "libcurl" }
      ]
    })
  ]
});