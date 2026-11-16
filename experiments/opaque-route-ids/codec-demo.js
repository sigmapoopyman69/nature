// Isolated proof of concept only — NOT connected to Autumn/Scramjet.
// Shows the 64-character opaque-ID idea. This in-memory map is deliberately
// not production-ready: it is not shared with the service worker or other tabs.

const routes = new Map();

function randomId() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export function encodeDestination(destination) {
  const url = new URL(destination);
  const id = randomId();
  routes.set(id, url.href);
  return id;
}

export function decodeDestination(id) {
  if (!/^[a-f0-9]{64}$/.test(id)) {
    throw new TypeError("Invalid opaque route ID");
  }
  const destination = routes.get(id);
  if (!destination) {
    throw new Error("Unknown or expired opaque route ID");
  }
  return destination;
}

// Tiny self-check for the isolated experiment.
const sample = "https://example.com/path?q=autumn";
const id = encodeDestination(sample);
if (id.length !== 64 || decodeDestination(id) !== sample) {
  throw new Error("Opaque route ID self-check failed");
}
console.info("[opaque-route experiment] local encode/decode check passed");
