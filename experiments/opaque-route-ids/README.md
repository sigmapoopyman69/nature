# Opaque route ID experiment

This branch is an isolated experiment. It does not change Autumn's live browser.

## Goal

Explore replacing readable destination URLs in Scramjet's rewritten path with random 64-character identifiers.

## Important limitation

Scramjet 2.0.67-alpha.2 exposes a synchronous `config.codec.encode/decode` pair. Its controller serializes codec functions into injected page and worker code. A JavaScript Map created in one realm is not automatically shared with the service worker, injected page, and other frames. Therefore a random-ID Map in the main page is not a complete implementation and must not be wired into Autumn as-is.

A real implementation needs a shared resolver available to every request-handling realm, or server-side opaque-token resolution. The current Wisp endpoint is a raw tunnel, not that resolver.

## Security notes

- HTTPS/WSS encrypt data in transit between the browser and Autumn's endpoint.
- A random path token is an identifier, not encryption.
- A client-side secret cannot be kept secret from someone inspecting the client.
- The remote endpoint still needs to know the destination to connect to it.
- This experiment does not promise to hide destinations from every DevTools surface.

## Acceptance tests before integration

1. Top-level navigation uses an opaque ID.
2. Relative scripts, stylesheets, images, fonts, and API requests resolve correctly.
3. Redirects and history navigation still work.
4. WebSockets and streaming media continue to work.
5. Multiple tabs do not share or overwrite mappings.
6. Service-worker restart does not lose mappings.
7. Expired/unknown IDs fail closed.
8. The main Autumn branch remains unchanged until all tests pass.
