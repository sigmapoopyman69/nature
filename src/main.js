window.__autumnModuleLoaded = true;

const BASE = "/nature/";
const WISP_URL = "wss://autumn.wisp.uno/wisp/";
const TICKET_URL = "https://autumn.wisp.uno/ticket";

const form = document.getElementById("searchForm");
const address = document.getElementById("address");
const status = document.getElementById("status");
const provider = document.getElementById("provider");
const panel = document.getElementById("settingsPanel");
const wispInput = document.getElementById("wispUrl");
const browserShell = document.getElementById("browserShell");
const browserForm = document.getElementById("browserForm");
const browserAddress = document.getElementById("browserAddress");
const browserStatus = document.getElementById("browserStatus");
const browserFrame = document.getElementById("browserFrame");

let controller = null;
let frame = null;
let bootPromise = null;
let keepalive = null;

// Synchronous byte-mask URL codec. No WebCrypto dependency; works in both
// page and Scramjet worker contexts. This is obfuscation, not secure encryption.
const AUTUMN_URL_MASK = new TextEncoder().encode("autumn-url-mask-v3");

function autumnUrlBytesToBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function autumnUrlBase64UrlToBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function autumnUrlApplyMask(bytes) {
  const output = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    output[i] = bytes[i] ^ AUTUMN_URL_MASK[i % AUTUMN_URL_MASK.length];
  }
  return output;
}

function autumnUrlCloakEncode(value) {
  if (!value) return value;
  return "m3_" + autumnUrlBytesToBase64Url(autumnUrlApplyMask(new TextEncoder().encode(value)));
}

function autumnUrlMetadataEncode(value) {
  if (!value) return value;
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return "a1_" + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function autumnUrlMetadataDecode(value) {
  if (typeof value !== "string" || !value.startsWith("a1_")) return value;
  try {
    const base64 = value.slice(3).replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return value;
  }
}

function autumnUrlCloakDecode(value) {
  if (!value) return value;
  if (value.startsWith("m3_")) {
    try { return new TextDecoder().decode(autumnUrlApplyMask(autumnUrlBase64UrlToBytes(value.slice(3)))); }
    catch { return value; }
  }
  if (value.startsWith("a1_")) {
    try { return new TextDecoder().decode(autumnUrlBase64UrlToBytes(value.slice(3))); }
    catch { return value; }
  }
  try { return decodeURIComponent(value); }
  catch { return value; }
}

provider.value = localStorage.getItem("autumn-search-provider") || "brave";
provider.addEventListener("change", () => {
  localStorage.setItem("autumn-search-provider", provider.value);
});

wispInput.value = WISP_URL;
document.getElementById("settingsToggle").addEventListener("click", () => panel.classList.toggle("open"));
document.getElementById("closeSettings").addEventListener("click", () => panel.classList.remove("open"));
document.getElementById("saveSettings").addEventListener("click", () => {
  wispInput.value = WISP_URL;
  localStorage.setItem("autumn-wisp-url", WISP_URL);
  status.textContent = "secure connection address confirmed.";
  panel.classList.remove("open");
});

function searchUrl(query) {
  const q = encodeURIComponent(query);
  const engines = {
    brave: "https://search.brave.com/search?q=" + q,
    duckduckgo: "https://duckduckgo.com/?q=" + q,
    google: "https://www.google.com/search?q=" + q,
    bing: "https://www.bing.com/search?q=" + q
  };
  return engines[provider.value] || engines.brave;
}

function normalizeTarget(value) {
  const input = value.trim();
  if (!input) throw new Error("enter a website or search term first.");

  let target;
  if (/^https?:\/\//i.test(input)) target = input;
  else if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/:?#]|$)/i.test(input)) target = "https://" + input;
  else target = searchUrl(input);

  const url = new URL(target);
  if (
    url.hostname === "youtube.com" ||
    url.hostname.endsWith(".youtube.com") ||
    url.hostname === "youtube-nocookie.com" ||
    url.hostname.endsWith(".youtube-nocookie.com")
  ) {
    url.searchParams.set("hl", "en");
    url.searchParams.set("gl", "US");
    url.searchParams.set("persist_hl", "1");
  }
  return url.href;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error("could not load runtime file: " + src));
    document.head.append(script);
  });
}

function waitForServiceWorkerControl(registration) {
  if (navigator.serviceWorker.controller) return Promise.resolve(navigator.serviceWorker.controller);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
      reject(new Error("service worker did not take control. Reload Autumn and try again."));
    }, 12000);
    function changed() {
      clearTimeout(timeout);
      resolve(navigator.serviceWorker.controller || registration.active);
    }
    navigator.serviceWorker.addEventListener("controllerchange", changed, { once: true });
  });
}

async function getTemporaryTicket() {
  const response = await fetch(TICKET_URL, { method: "POST", cache: "no-store" });
  const body = await response.text();
  if (!response.ok) throw new Error("ticket request failed (HTTP " + response.status + "): " + body.slice(0, 160));
  let data;
  try { data = JSON.parse(body); }
  catch { throw new Error("ticket endpoint returned invalid JSON."); }
  if (!data.ticket) throw new Error("ticket endpoint did not issue a ticket.");
  return data.ticket;
}

async function initializeRuntime() {
  if (controller) return;
  if (bootPromise) return bootPromise;

  bootPromise = (async () => {
    if (!("serviceWorker" in navigator)) throw new Error("service workers are not supported in this browser.");

    browserStatus.textContent = "registering the Scramjet service worker...";
    const registration = await navigator.serviceWorker.register(BASE + "sw.js", {
      scope: BASE,
      updateViaCache: "none"
    });
    await navigator.serviceWorker.ready;
    const serviceworker = await waitForServiceWorkerControl(registration);
    if (!serviceworker) throw new Error("Scramjet service worker is unavailable.");

    browserStatus.textContent = "loading Scramjet runtime...";
    await loadScript(BASE + "scram/scramjet.js");
    await loadScript(BASE + "controller/controller.api.js");
    await loadScript(BASE + "utils/scramjet-utils.js");

    if (!window.$scramjetController?.Controller || !window.$scramjetUtils) {
      throw new Error("Scramjet controller or utilities API did not load.");
    }

    const ControllerAPI = window.$scramjetController;
    const ScramjetUtils = window.$scramjetUtils;

    // Scramjet 2.0.67-alpha.2 rewrites omitted History URLs as "undefined".
    // Preserve the current proxied URL when a site calls pushState/replaceState
    // with only the state and title arguments.
    class HistoryCompatibilityPlugin extends ControllerAPI.ManagedPlugin {
      constructor() {
        super("autumn-history-compat", []);
      }

      install(scramjetFrame) {
        super.install(scramjetFrame);
        this.tap(scramjetFrame.hooks.init.pre, context => {
          if (!context.isTopLevel) return;

          const historyPrototype = context.window.History.prototype;
          for (const method of ["pushState", "replaceState"]) {
            const original = historyPrototype[method];
            historyPrototype[method] = function (state, unused, url) {
              return original.call(this, state, unused, url ?? context.client.url.href);
            };
          }
        });
      }
    }

    // Encode Scramjet's redirect initiator metadata in the visible proxy URL.
    // Restore it after request parsing so fetch metadata and redirects still
    // receive the original origin.
    class UrlMetadataCodecPlugin extends ControllerAPI.ManagedPlugin {
      constructor() {
        super("autumn-url-metadata-codec", []);
      }

      install(scramjetFrame) {
        super.install(scramjetFrame);

        this.tap(scramjetFrame.hooks.fetch.intercept, context => {
          const encodedOrigin = context.parsed.fetchInitiatorOrigin;
          if (typeof encodedOrigin === "string" && encodedOrigin.startsWith("a1_")) {
            context.parsed.fetchInitiatorOrigin = autumnUrlMetadataDecode(encodedOrigin);
          }
        });

        this.tap(scramjetFrame.hooks.fetch.response, (_context, props) => {
          const response = props.response;
          const headers = response?.headers;
          if (!headers || typeof headers.get !== "function" || typeof headers.set !== "function") return;
          if (![301, 302, 303, 307, 308].includes(response.status)) return;

          const locationHeader = headers.get("location");
          if (!locationHeader) return;

          try {
            const redirectUrl = new URL(locationHeader, globalThis.location.href);
            const initiator = redirectUrl.searchParams.get("$io");
            if (initiator && !initiator.startsWith("a1_")) {
              redirectUrl.searchParams.set("$io", autumnUrlMetadataEncode(initiator));
              headers.set("location", redirectUrl.href);
            }
          } catch (error) {
            console.warn("[Autumn] Could not encode redirect metadata:", error);
          }
        });
      }
    }

    browserStatus.textContent = "requesting a temporary secure ticket...";
    const ticket = await getTemporaryTicket();
    const wisp = new URL(WISP_URL);
    wisp.searchParams.set("ticket", ticket);

    // libcurl-transport validates the configured Wisp URL with endsWith("/").
    // Keep the ticket query parameter unchanged, while adding a harmless empty
    // query component after it so the complete URL string ends with a slash.
    // The request path remains /wisp/ and the backend still reads the same ticket.
    const authenticatedWispUrl = wisp.toString() + "&/";

    browserStatus.textContent = "connecting to the secure Wisp transport...";
    const { default: LibcurlClient } = await import(BASE + "libcurl/index.mjs");
    const transport = new LibcurlClient({ wisp: authenticatedWispUrl });

    controller = new window.$scramjetController.Controller({
      serviceworker,
      transport,
      config: {
        prefix: BASE + "~/sj/",
        codec: {
          encode: autumnUrlCloakEncode,
          decode: autumnUrlCloakDecode
        },
        scramjetPath: BASE + "scram/scramjet.js",
        wasmPath: BASE + "scram/scramjet.wasm",
        injectPath: BASE + "controller/controller.inject.js"
      }
    });

    await controller.wait();

    // Cache fetched subresources (including image assets) and keep Autumn's
    // address bar synchronized with in-page navigation.
    frame = controller.createFrame(browserFrame, {
      plugins: [
        new HistoryCompatibilityPlugin(),
        new UrlMetadataCodecPlugin(),
        new ScramjetUtils.UrlWatcherPlugin(url => {
          browserAddress.value = url;
        }),
        new ScramjetUtils.HttpCachePlugin()
      ]
    });

    // The service worker's in-memory frame table can be lost when the browser
    // suspends it. Ping the actual active worker every 15 seconds; use the
    // controller reference as a fallback if navigator.controller is absent.
    const pingServiceWorker = () => {
      const worker = navigator.serviceWorker.controller || serviceworker;
      try { worker?.postMessage("keepalive"); } catch (error) {
        console.warn("[Autumn] service worker keepalive failed:", error);
      }
    };
    pingServiceWorker();
    keepalive = window.setInterval(pingServiceWorker, 15000);
    navigator.serviceWorker.addEventListener("controllerchange", pingServiceWorker);

    browserStatus.textContent = "autumn browser is ready.";
  })();

  try {
    await bootPromise;
  } catch (error) {
    bootPromise = null;
    controller = null;
    throw error;
  }
}

async function navigate(value) {
  try {
    const target = normalizeTarget(value);
    browserShell.hidden = false;
    browserAddress.value = target;
    browserStatus.textContent = "starting autumn browser...";
    await initializeRuntime();
    browserStatus.textContent = "routing " + new URL(target).hostname + " through Scramjet...";
    if (!frame || frame.element !== browserFrame) {
      throw new Error("Scramjet did not attach its browsing frame to Autumn's browser workspace.");
    }

    // Frame.go() must rewrite the destination to this frame's private Scramjet route.
    // Never fall back to assigning the destination URL directly to the top-level page.
    frame.go(new URL(target).href);

    const routedUrl = new URL(frame.element.src, location.href);
    const framePrefix = new URL(frame.prefix, location.href).pathname;
    if (routedUrl.origin !== location.origin || !routedUrl.pathname.startsWith(framePrefix)) {
      throw new Error("Scramjet did not create an Autumn-routed URL. The page was not opened directly.");
    }

    browserStatus.textContent = "opening " + new URL(target).hostname + " inside autumn...";
  } catch (error) {
    browserShell.hidden = false;
    browserStatus.textContent = "could not open page: " + error.message;
    console.error("[Autumn]", error);
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  navigate(address.value);
});
browserForm.addEventListener("submit", event => {
  event.preventDefault();
  navigate(browserAddress.value);
});

document.getElementById("browserBack").addEventListener("click", () => frame?.back?.());
document.getElementById("browserForward").addEventListener("click", () => frame?.forward?.());
document.getElementById("browserReload").addEventListener("click", () => frame?.reload?.());
document.getElementById("browserHome").addEventListener("click", () => navigate("https://search.brave.com"));
document.getElementById("browserClose").addEventListener("click", () => { browserShell.hidden = true; });
document.querySelectorAll("[data-url]").forEach(button => button.addEventListener("click", () => navigate(button.dataset.url)));

const goto = new URL(location.href).searchParams.get("goto");
if (goto) {
  history.replaceState(null, "", BASE);
  navigate(goto);
}