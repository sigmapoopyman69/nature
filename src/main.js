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
  if (/^https?:\/\//i.test(input)) return input;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/:?#]|$)/i.test(input)) return "https://" + input;
  return searchUrl(input);
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

    if (!window.$scramjetController?.Controller) {
      throw new Error("Scramjet controller API did not load.");
    }

    browserStatus.textContent = "requesting a temporary secure ticket...";
    const ticket = await getTemporaryTicket();
    const wisp = new URL(WISP_URL);
    wisp.searchParams.set("ticket", ticket);

    browserStatus.textContent = "connecting to the secure Wisp transport...";
    const { default: LibcurlClient } = await import(BASE + "libcurl/index.mjs");
    const transport = new LibcurlClient({ wisp: wisp.toString() });

    controller = new window.$scramjetController.Controller({
      serviceworker,
      transport,
      config: {
        prefix: BASE + "~/sj/",
        scramjetPath: BASE + "scram/scramjet.js",
        wasmPath: BASE + "scram/scramjet.wasm",
        injectPath: BASE + "controller/controller.inject.js"
      }
    });

    await controller.wait();
    frame = controller.createFrame(browserFrame);
    keepalive = window.setInterval(() => {
      navigator.serviceWorker.controller?.postMessage("keepalive");
    }, 15000);
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
    browserStatus.textContent = "loading " + new URL(target).hostname + "...";
    frame.go(target);
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