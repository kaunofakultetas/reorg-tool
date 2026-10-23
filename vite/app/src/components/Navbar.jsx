// -----------------------------------------------------------
//  [*] Navbar — the burgundy top bar
//
//  Shown on every page: the VU KnF logo linking back to "/"
//  (which redirects into the tool) and the tool's title. This
//  stack holds a single page, so the bar carries no navigation
//  controls — it is a header, not a menu.
//
//  Used by:
//    - App.jsx — the page shell
// -----------------------------------------------------------

import { Link } from 'react-router-dom';


export default function Navbar() {
  return (
    <div className="bg-[var(--color-primary)] py-2 px-5 text-white font-bold">
      <div className="flex flex-wrap items-center gap-4">

        {/* Logo links back to "/", which redirects into the tool */}
        <Link to="/">
          <img src="/img/logo_knf.png" alt="VU Kauno fakultetas" className="h-[60px]" />
        </Link>

        {/* App title in an outlined pill, also leading home */}
        <Link to="/">
          <div className="border border-white rounded-[15px] text-white font-normal py-2 px-3">
            51% Atakos Įrankis
          </div>
        </Link>

      </div>
    </div>
  );
}
