// -----------------------------------------------------------
//  [*] Test support — rendering with the app's providers
//
//  Pages and components are rendered the way App.jsx frames
//  them in production, so nothing in a test is fed a context
//  the real app would not provide:
//
//    QueryClientProvider  — one TanStack client per render,
//                           retries off and no cache kept (the
//                           retry policy of main.jsx is not the
//                           subject of a page test)
//    StyledEngineProvider + ThemeProvider + CssBaseline
//                         — the same MUI stack and theme as
//                           App.jsx
//    MemoryRouter         — for renderPage: starts at `route`
//                           (the navbar's links need a router)
//
//  renderPage puts the frame above around any element;
//  renderApp mounts the REAL App.jsx instead — its own
//  BrowserRouter, navbar, footer and every route — started at
//  a route through the History API.
//
//  Used by:
//    - every component and page test
// -----------------------------------------------------------

import { Component } from 'react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { StyledEngineProvider } from '@mui/material/styles';
import theme from '@/theme';
import App from '@/App';







// -----------------------------------------------------------
// makeQueryClient
// -----------------------------------------------------------
//
// A client whose failures surface at once: no retries (a page
// under test must show its error state on the first answer),
// zero retry delay for queries that set their own retry count,
// no garbage-collection wait so a test leaves nothing behind.
//
// Used by:
//   - renderPage, renderApp (below)
//   - core/app.test.jsx — the App under StrictMode, with
//     main.jsx's retry count
//   - hooks/use-reorg-attack.test.jsx — the hook's own client
// -----------------------------------------------------------

export function makeQueryClient(overrides = {}) {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0, ...overrides },
      mutations: { retry: false },
    },
  });
}







// -----------------------------------------------------------
// TestErrorBoundary
// -----------------------------------------------------------
//
// Catches a render-time throw of the element under test and
// shows it as "render crashed: <message>" — so a page that
// cannot cope with a backend answer fails its test with the
// real message instead of an unhandled exception from deep
// inside React (contract.js' expectNoCrash reads it). The
// App has no error boundary of its own: under renderApp a
// throw blanks the whole tree, which expectNoCrash catches
// by the shell having gone.
//
// Used by:
//   - renderPage (below)
// -----------------------------------------------------------

export class TestErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <div data-testid="render-crashed">render crashed: {String(this.state.error?.message ?? this.state.error)}</div>;
    }
    return this.props.children;
  }
}







// -----------------------------------------------------------
// Providers
// -----------------------------------------------------------
//
// App.jsx's MUI stack around `children`, inside the query
// client.
//
// Used by:
//   - renderPage (below)
// -----------------------------------------------------------

function Providers({ client, children }) {
  return (
    <QueryClientProvider client={client}>
      <StyledEngineProvider injectFirst>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          {children}
        </ThemeProvider>
      </StyledEngineProvider>
    </QueryClientProvider>
  );
}







// -----------------------------------------------------------
// renderPage
// -----------------------------------------------------------
//
// Renders an element inside the production frame (see the
// header) and returns Testing Library's result plus the query
// client and a userEvent instance. The frame is Testing
// Library's `wrapper`, so a rerender keeps it — and the
// element's state — and only swaps the element.
//
// `route` is the memory router's initial entry, "/" unless
// the test names another; the query client is a fresh
// makeQueryClient one.
//
// Used by:
//   - components/*, the block details and fork diagram tests
//   - reorg-attack/page.jsx — renderReorgPage, the whole page
// -----------------------------------------------------------

export function renderPage(ui, { route = '/' } = {}) {
  const queryClient = makeQueryClient();
  const user = userEvent.setup();

  const Frame = ({ children }) => (
    <Providers client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <TestErrorBoundary>{children}</TestErrorBoundary>
      </MemoryRouter>
    </Providers>
  );

  const result = render(ui, { wrapper: Frame });

  return { ...result, queryClient, user };
}







// -----------------------------------------------------------
// renderApp
// -----------------------------------------------------------
//
// The whole application: App.jsx with its own BrowserRouter,
// navbar, footer and routes, the location moved to `route`
// first (history.replaceState — jsdom keeps the origin). Only
// the query client comes from here, as main.jsx provides it in
// production.
//
// Used by:
//   - core/app.test.jsx, core/smoke.test.jsx
//   - components/footer.test.jsx — the footer in the shell
//   - contract/route-sweep.test.jsx — every route
// -----------------------------------------------------------

export function renderApp({ route = '/' } = {}) {
  window.history.replaceState(null, '', route);
  const queryClient = makeQueryClient();
  const user = userEvent.setup();

  const result = render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );

  return { ...result, queryClient, user };
}
