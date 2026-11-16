import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { controllerPath } from "@mercuryworkshop/scramjet-controller/path";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);
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