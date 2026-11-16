import LibcurlClient from "@mercuryworkshop/libcurl-transport";
import { Controller } from "@mercuryworkshop/scramjet-controller";
import { defaultConfigDev } from "@mercuryworkshop/scramjet";
import {
  HttpCachePlugin,
  UrlWatcherPlugin,
  CatchEscapedLinksPlugin
} from "@mercuryworkshop/scramjet-utils";

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
let runtimePromise = null;

provider.value = localStorage.getItem("autumn-search-provider") || "brave";
provider.addEventListener("change", () => {
  localStorage.setItem("autumn-search-provider", provider.value);
});

const savedWisp = (() => {
  const old = localStorage.getItem("autumn-wisp-url");
  const current = old && old.includes("autumn.wisp.uno")
    ? old.replace("autumn.wisp.uno:14497", "autumn.wisp.uno")
    : WISP_URL;
  localStorage.setItem("autumn-wisp-url", current);
  return current;
})();
wispInput.value = savedWisp;

document.getElementById("settingsToggle").addEventListener("click", () => {
  panel.classList.toggle("open");
});
document.getElementById("closeSettings").addEventListener("click", () => {
  panel.classList.remove("open");
});
document.getElementById("saveSettings").addEventListener("click", () => {
  const value = wispInput.value.trim();
  if (value !== WISP_URL) {
    status.textContent = "the secure autumn connection is managed by the backend.";
    wispInput.value = WISP_URL;
    return;
  }
  localStorage.setItem("autumn-wisp-url", value);
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
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/:?#]|$)/i.test(input)) {
    return "https://" + input;
  }
  return searchUrl(input);
}

async function getTemporaryTicket() {
  const response = await fetch(TICKET_URL, {
    method: "POST",
    cache: "no-store"
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error("ticket request failed (HTTP " + response.status + "): " + body.slice(0, 180));
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("ticket endpoint returned invalid JSON.");
  }
  if (!data.ticket) throw new Error("ticket endpoint did not issue a ticket.");
  return data.ticket;
}

async function initializeRuntime() {
  if (controller) return;
  if (runtimePromise) return runtimePromise;

  runtimePromise = (async () => {
    browserStatus.textContent = "registering the browsing service worker...";
    if (!("serviceWorker" in navigator)) {
      throw new Error("this browser does not support service workers.");
    }

    const registration = await navigator.serviceWorker.register(BASE + "sw.js", {
      scope: BASE
    });
    await navigator.serviceWorker.ready;

    const serviceworker = navigator.serviceWorker.controller || registration.active;
    if (!serviceworker) {
      throw new Error("the Scramjet service worker did not become active. Reload Autumn and try again.");
    }

    browserStatus.textContent = "requesting a short-lived secure connection ticket...";
    const ticket = await getTemporaryTicket();
    const wisp = new URL(WISP_URL);
    wisp.searchParams.set("ticket", ticket);

    browserStatus.textContent = "connecting Scramjet to the Wisp transport...";
    const transport = new LibcurlClient({ wisp: wisp.toString() });
    controller = new Controller({
      serviceworker,
      transport,
      scramjetConfig: defaultConfigDev
    });

    await controller.wait();

    const cachePlugin = new HttpCachePlugin();
    const urlWatcher = new UrlWatcherPlugin((url) => {
      browserAddress.value = url.href;
    });
    const escapedLinks = new CatchEscapedLinksPlugin((url) =>
      new URL(BASE + "?goto=" + encodeURIComponent(url.href), location.origin)
    );

    frame = controller.createFrame(browserFrame, {
      plugins: [cachePlugin, urlWatcher, escapedLinks]
    });

    browserStatus.textContent = "autumn browser is ready.";
  })();

  try {
    await runtimePromise;
  } catch (error) {
    runtimePromise = null;
    controller = null;
    throw error;
  }
}

async function navigate(value) {
  let target;
  try {
    target = normalizeTarget(value);
    browserShell.hidden = false;
    browserAddress.value = target;
    browserStatus.textContent = "starting autumn browser...";
    await initializeRuntime();
    browserStatus.textContent = "loading " + new URL(target).hostname + "...";
    frame.go(target);
  } catch (error) {
    browserShell.hidden = false;
    browserStatus.textContent = "could not open page: " + error.message;
    console.error("[Autumn] navigation error:", error);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  navigate(address.value);
});

browserForm.addEventListener("submit", (event) => {
  event.preventDefault();
  navigate(browserAddress.value);
});

document.getElementById("browserBack").addEventListener("click", () => frame?.back());
document.getElementById("browserForward").addEventListener("click", () => frame?.forward());
document.getElementById("browserReload").addEventListener("click", () => frame?.reload());
document.getElementById("browserHome").addEventListener("click", () => navigate("https://search.brave.com"));
document.getElementById("browserClose").addEventListener("click", () => {
  browserShell.hidden = true;
});
document.querySelectorAll("[data-url]").forEach((button) => {
  button.addEventListener("click", () => navigate(button.dataset.url));
});

const goto = new URL(location.href).searchParams.get("goto");
if (goto) {
  history.replaceState(null, "", BASE);
  navigate(goto);
}