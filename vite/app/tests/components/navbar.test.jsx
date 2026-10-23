// -----------------------------------------------------------
//  [*] Tests — Navbar (the burgundy top bar)
//
//  The bar on its own, rendered at the tool's route with the
//  location probe beside it:
//    - the VU KnF logo, leading home
//    - the app's name in an outlined pill, leading home too
//    - nothing else to press: a header, not a menu
//  (Inside the App shell — where "/" lands — see
//  core/app.test.jsx; that the logo file ships in public/ is a
//  structural rule.)
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderPage } from '../support/render';
import { LocationProbe, currentPath } from '../support/shell/router';
import Navbar from '@/components/Navbar';


const renderNavbar = () => renderPage(<><Navbar /><LocationProbe /></>, { route: '/reorgattack' });

const logo = () => screen.getByRole('link', { name: 'VU Kauno fakultetas' });
const pill = () => screen.getByRole('link', { name: '51% Atakos Įrankis' });







// -----------------------------------------------------------
// The logo
// -----------------------------------------------------------

describe('Navbar — the logo', () => {

  it('is the VU KnF logo, named for the faculty, leading home', () => {
    renderNavbar();
    expect(logo()).toHaveAttribute('href', '/');
    expect(within(logo()).getByRole('img')).toHaveAttribute('src', '/img/logo_knf.png');
  });


  it('takes the student to "/" when clicked', async () => {
    const { user } = renderNavbar();
    expect(currentPath()).toBe('/reorgattack');
    await user.click(logo());
    expect(currentPath()).toBe('/');
  });
});







// -----------------------------------------------------------
// The name pill
// -----------------------------------------------------------

describe('Navbar — the app\'s name', () => {

  it('says "51% Atakos Įrankis" and leads home', () => {
    renderNavbar();
    expect(pill()).toHaveAttribute('href', '/');
    expect(pill()).toHaveTextContent(/^51% Atakos Įrankis$/);
  });


  // jsdom gets no Tailwind CSS: the outline and the rounding
  // ARE these classes — the only place the pill's look lives
  it('sits in an outlined, rounded pill in plain white type', () => {
    renderNavbar();
    const box = within(pill()).getByText('51% Atakos Įrankis');
    expect(box).toHaveClass('border', 'border-white', 'rounded-[15px]', 'text-white', 'font-normal');
  });


  it('takes the student to "/" when clicked', async () => {
    const { user } = renderNavbar();
    await user.click(pill());
    expect(currentPath()).toBe('/');
  });
});







// -----------------------------------------------------------
// Nothing else
// -----------------------------------------------------------

describe('Navbar — a header, not a menu', () => {

  it('holds the logo and then the name — nothing else to press', () => {
    renderNavbar();
    expect(screen.getAllByRole('link')).toEqual([logo(), pill()]);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });
});
