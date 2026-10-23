// -----------------------------------------------------------
//  [*] Test support — where the router is, and moving it
//
//  The shell's links navigate (the navbar's logo and title);
//  a test needs to see where a click took the student — the
//  address bar:
//
//    LocationProbe / currentPath — for renderPage (a memory
//                   router): the probe renders the router's
//                   pathname + search where currentPath
//                   reads it
//    navigateTo   — for renderApp (App's own BrowserRouter):
//                   what an address typed does — the History
//                   API plus the popstate the router listens
//                   to
//
//  Under renderApp the address bar is window.location itself.
//
//  Used by:
//    - components/navbar.test.jsx
//    - core/app.test.jsx
// -----------------------------------------------------------

import { act, screen } from '@testing-library/react';
import { useLocation } from 'react-router-dom';







// -----------------------------------------------------------
// LocationProbe / currentPath
// -----------------------------------------------------------
//
// The probe is rendered beside the element under test, inside
// renderPage's memory router, and writes the router's pathname
// and search into a hidden output; currentPath reads it back,
// so a test can assert where a click took the student.
//
// Used by:
//   - the component tests that render with renderPage
// -----------------------------------------------------------

export function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location" hidden>{pathname + search}</output>;
}

export const currentPath = () => screen.getByTestId('location').textContent;







// -----------------------------------------------------------
// navigateTo
// -----------------------------------------------------------
//
// Pushes a path onto the history and fires the popstate the
// router listens to, inside act — the router then renders
// that path as if the student had typed it.
//
// Used by:
//   - core/app.test.jsx
// -----------------------------------------------------------

export async function navigateTo(path) {
  await act(async () => {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
  });
}
