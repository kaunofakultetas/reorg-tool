// -----------------------------------------------------------
//  [*] Test support — the origin the SPA runs on
//
//  jsdom's origin is pinned (vitest's default,
//  http://localhost:3000): the SPA's relative "/api/…"
//  requests resolve against it, and the msw handlers listen on
//  it.
//
//  Routing needs no double: App.jsx runs its own
//  BrowserRouter, which jsdom supports through the History API
//  — tests set the start path with history.replaceState (see
//  render.jsx renderApp).
//
//  Used by:
//    - backend/server.js, backend/handlers.js — TEST_ORIGIN
// -----------------------------------------------------------

export const TEST_ORIGIN = 'http://localhost:3000';
