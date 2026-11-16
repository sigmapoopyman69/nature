import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);
const packageDir = (name) => dirname(require.resolve(name));

export default defineConfig({
  base: "/nature/",
  plugins: [
    viteStaticCopy({
      targets: [
        { src: `${scramjetPath}/*`, dest: "scram" },
        { src: `${packageDir("@mercuryworkshop/scramjet-controller")}/*`, dest: "controller" },
        { src: `${packageDir("@mercuryworkshop/scramjet-utils")}/*`, dest: "utils" },
        { src: `${packageDir("@mercuryworkshop/libcurl-transport")}/*`, dest: "libcurl" }
      ]
    })
  ]
});