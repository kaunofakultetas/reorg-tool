// -----------------------------------------------------------
//  [*] Entry point — mounts the React app
//
//  Renders <App /> (providers + Navbar/Footer shell + the
//  routes, see App.jsx) into the #root div of index.html,
//  wrapped in StrictMode and the TanStack Query provider —
//  ONE QueryClient owns every backend fetch: the two reorg
//  polls (the chain and the node status), and the query
//  invalidations the four attack actions fire on success.
//  Global styles (Tailwind) are pulled in here.
// -----------------------------------------------------------

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '@/App';
import './index.css';


// One client for the whole app. retry 1: a poll that fails
// twice in a row should surface its error state, not spin.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
