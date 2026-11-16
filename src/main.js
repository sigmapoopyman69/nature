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
const tabsBar = document.getElementById("tabsBar");
const addTabButton = document.getElementById("addTab");

let controller = null;
let activeTabId = null;
let tabs = [];
let nextTabId = 1;
let bootPromise = null;
let keepalive = null;

const DEFAULT_RELAY = WISP_URL;
const savedRelay = (() => { try { return localStorage.getItem("autumn-custom-relay") || ""; } catch { return ""; } })();
wispInput.value = savedRelay;

provider.value = localStorage.getItem("autumn-search-provider") || "brave";
provider.addEventListener("change", () => {
  localStorage.setItem("autumn-search-provider", provider.value);
});

document.getElementById("settingsToggle").addEventListener("click", () => panel.classList.toggle("open"));
document.getElementById("closeSettings").addEventListener("click", () => panel.classList.remove("open"));
document.getElementById("saveSettings").addEventListener("click", () => {
  const relay = wispInput.value.trim();
  if (relay && !/^wss:\/\//i.test(relay)) {
    status.textContent = "relay address must start with wss://";
    return;
  }
  try {
    if (relay) localStorage.setItem("autumn-custom-relay", relay);
    else localStorage.removeItem("autumn-custom-relay");
  } catch {}
  status.textContent = relay ? "custom relay saved. reload a tab to use it." : "default secure relay selected.";
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
  // Ask YouTube for its English (US) interface instead of inheriting a
  // Romanian or other browser/account locale on the first navigation.
  if (/(^|\.)youtube\.com$/i.test(url.hostname) ||
      /(^|\.)youtube-nocookie\.com$/i.test(url.hostname)) {
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
  if (navigator.serviceWorker.controller) {
    try { sessionStorage.removeItem("autumn-sw-reload-attempt"); } catch {}
    return Promise.resolve(navigator.serviceWorker.controller);
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
      const active = registration.active;
      // On a first visit, an already-activated worker may not claim this
      // document until it is loaded again. Reload once, never in a loop.
      if (active && active.state === "activated") {
        let attempted = false;
        try {
          attempted = sessionStorage.getItem("autumn-sw-reload-attempt") === "1";
          if (!attempted) sessionStorage.setItem("autumn-sw-reload-attempt", "1");
        } catch { attempted = true; }
        if (!attempted) {
          location.reload();
          return;
        }
      }
      reject(new Error("service worker is active but this page is not controlled. Check that /nature/sw.js is available, then reopen Autumn."));
    }, 7000);
    function changed() {
      clearTimeout(timeout);
      try { sessionStorage.removeItem("autumn-sw-reload-attempt"); } catch {}
      const worker = navigator.serviceWorker.controller;
      if (worker) resolve(worker);
      else reject(new Error("service worker changed, but the page is still not controlled."));
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
    // Listen before waiting for ready so a fast controllerchange cannot be missed.
    const controlPromise = waitForServiceWorkerControl(registration);
    await navigator.serviceWorker.ready;
    const serviceworker = await controlPromise;
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

    browserStatus.textContent = "requesting a temporary secure ticket...";
    const customRelay = (() => { try { return localStorage.getItem("autumn-custom-relay") || ""; } catch { return ""; } })();
    const relayUrl = customRelay || DEFAULT_RELAY;
    const wisp = new URL(relayUrl);
    if (!customRelay) {
      const ticket = await getTemporaryTicket();
      wisp.searchParams.set("ticket", ticket);
    }

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
        scramjetPath: BASE + "scram/scramjet.js",
        wasmPath: BASE + "scram/scramjet.wasm",
        injectPath: BASE + "controller/controller.inject.js"
      }
    });

    await controller.wait();

    // Cache fetched subresources (including image assets) and keep Autumn's
    // address bar synchronized with in-page navigation.
    // Each tab owns its own Scramjet frame and browsing history.
    tabs.forEach(tab => {
      if (!tab.frame) tab.frame = createScramjetFrame(tab.element, ControllerAPI, ScramjetUtils);
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

function createScramjetFrame(element, ControllerAPI, ScramjetUtils) {
  const tab = tabs.find(item => item.element === element);
  return controller.createFrame(element, {
    plugins: [
      new (class extends ControllerAPI.ManagedPlugin {
        constructor() { super("autumn-history-compat", []); }
        install(scramjetFrame) {
          super.install(scramjetFrame);
          this.tap(scramjetFrame.hooks.init.pre, context => {
            if (!context.isTopLevel) return;
            const proto = context.window.History.prototype;
            for (const method of ["pushState", "replaceState"]) {
              const original = proto[method];
              proto[method] = function(state, unused, url) {
                return original.call(this, state, unused, url ?? context.client.url.href);
              };
            }
          });
        }
      })(),
      new ScramjetUtils.UrlWatcherPlugin(url => {
        if (tab && tab.id === activeTabId) browserAddress.value = url;
      }),
      new ScramjetUtils.HttpCachePlugin()
    ]
  });
}

function renderTabs() {
  tabsBar.replaceChildren();
  tabs.forEach(tab => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab-button" + (tab.id === activeTabId ? " active" : "");
    button.textContent = tab.title || "new tab";
    button.title = tab.url || "new tab";
    button.addEventListener("click", () => activateTab(tab.id));
    const close = document.createElement("span");
    close.textContent = " ×";
    close.addEventListener("click", event => { event.stopPropagation(); closeTab(tab.id); });
    button.append(close);
    tabsBar.append(button);
  });
}

function activateTab(id) {
  const selected = tabs.find(tab => tab.id === id);
  if (!selected) return;
  activeTabId = id;
  tabs.forEach(tab => { tab.element.hidden = tab.id !== id; });
  browserAddress.value = selected.url || "";
  browserStatus.textContent = selected.status || "ready.";
  renderTabs();
}

function renderStartPage(id) {
  // Reuse the real homepage's markup and stylesheet for an identical new-tab page.
  const style = document.querySelector("style")?.textContent || "";
  const scene = document.querySelector(".scene")?.outerHTML || "";
  const topbar = document.querySelector(".topbar")?.outerHTML || "";
  const content = document.querySelector(".content")?.outerHTML || "";
  const startProvider = provider.value;
  return `<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Autumn</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Italianno&display=swap" rel="stylesheet">
    <style>${style}</style></head><body>
    ${scene}${topbar}<main>${content}</main>
    <script>
      const tabId = ${JSON.stringify(id)};
      const open = value => parent.__autumnOpenTabSearch(tabId, value);
      const form = document.getElementById("searchForm");
      const input = document.getElementById("address");
      const engine = document.getElementById("provider");
      if (engine) engine.value = ${JSON.stringify(startProvider)};
      form?.addEventListener("submit", event => { event.preventDefault(); open(input.value); });
      engine?.addEventListener("change", () => parent.__autumnSetSearchProvider(engine.value));
      document.querySelectorAll("[data-url]").forEach(button => button.addEventListener("click", () => open(button.dataset.url)));
      document.querySelector(".settings-button")?.addEventListener("click", () => parent.__autumnOpenSettings());
      document.querySelector(".home-button")?.addEventListener("click", event => { event.preventDefault(); parent.__autumnResetTab(tabId); });
    <\/script></body></html>`;
}

window.__autumnOpenTabSearch = (id, value) => {
  if (activeTabId !== id) activateTab(id);
  navigate(value);
};

window.__autumnSetSearchProvider = value => {
  if ([...provider.options].some(option => option.value === value)) {
    provider.value = value;
    provider.dispatchEvent(new Event("change"));
  }
};

window.__autumnOpenSettings = () => panel.classList.add("open");

window.__autumnResetTab = id => {
  const tab = tabs.find(item => item.id === id);
  if (!tab) return;
  if (activeTabId !== id) activateTab(id);
  tab.url = "";
  tab.title = "autumn";
  tab.status = "autumn start page";
  tab.frame = null;
  tab.element.removeAttribute("src");
  tab.element.srcdoc = renderStartPage(id);
  browserAddress.value = "";
  browserStatus.textContent = tab.status;
  renderTabs();
};

function createTab(initialUrl = "") {
  const id = nextTabId++;
  const element = document.createElement("iframe");
  element.title = "autumn tab " + id;
  element.referrerPolicy = "no-referrer";
  element.className = "browser-tab-frame";
  element.hidden = true;
  document.getElementById("browserViews").append(element);
  const tab = { id, element, frame: null, url: "", title: "autumn", status: "autumn start page" };
  element.addEventListener("load", () => {
    if (!tab.url || !tab.frame) return;
    tab.status = "ready.";
    if (tab.id === activeTabId) browserStatus.textContent = tab.status;
    renderTabs();
  });
  tabs.push(tab);
  activateTab(id);
  element.srcdoc = renderStartPage(id);
  if (initialUrl) navigate(initialUrl);
  return tab;
}

function closeTab(id) {
  const index = tabs.findIndex(tab => tab.id === id);
  if (index < 0) return;
  tabs[index].element.remove();
  tabs.splice(index, 1);
  if (!tabs.length) {
    browserShell.hidden = true;
    activeTabId = null;
    return;
  }
  activateTab(tabs[Math.max(0, index - 1)].id);
}

async function navigate(value) {
  try {
    const target = normalizeTarget(value);
    browserShell.hidden = false;
    if (!tabs.length) createTab();
    let tab = tabs.find(item => item.id === activeTabId);
    if (!tab) tab = createTab();
    tab.url = target;
    tab.title = new URL(target).hostname;
    tab.status = "starting...";
    browserAddress.value = target;
    renderTabs();
    browserStatus.textContent = "starting autumn browser...";
    await initializeRuntime();
    if (!tab.frame) {
      const ControllerAPI = window.$scramjetController;
      const ScramjetUtils = window.$scramjetUtils;
      tab.frame = createScramjetFrame(tab.element, ControllerAPI, ScramjetUtils);
    }
    browserStatus.textContent = "routing " + new URL(target).hostname + " through Scramjet...";
    // srcdoc takes precedence over src; clear the start page before routing.
    tab.element.removeAttribute("srcdoc");
    tab.frame.go(new URL(target).href);
    const routedUrl = new URL(tab.element.src, location.href);
    const framePrefix = new URL(tab.frame.prefix, location.href).pathname;
    if (routedUrl.origin !== location.origin || !routedUrl.pathname.startsWith(framePrefix)) {
      throw new Error("Scramjet did not create an Autumn-routed URL.");
    }
    tab.status = "opening " + new URL(target).hostname + "...";
    browserStatus.textContent = tab.status;
    renderTabs();
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

document.getElementById("browserBack").addEventListener("click", () => tabs.find(t => t.id === activeTabId)?.frame?.back?.());
document.getElementById("browserForward").addEventListener("click", () => tabs.find(t => t.id === activeTabId)?.frame?.forward?.());
document.getElementById("browserReload").addEventListener("click", () => tabs.find(t => t.id === activeTabId)?.frame?.reload?.());
document.getElementById("browserHome").addEventListener("click", () => navigate("https://search.brave.com"));
document.getElementById("browserClose").addEventListener("click", () => closeTab(activeTabId));
addTabButton.addEventListener("click", () => createTab());
document.querySelectorAll("[data-url]").forEach(button => button.addEventListener("click", () => navigate(button.dataset.url)));

createTab();
const goto = new URL(location.href).searchParams.get("goto");
if (goto) {
  history.replaceState(null, "", BASE);
  navigate(goto);
}