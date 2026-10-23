// -----------------------------------------------------------
//  [*] Tests — Footer (the burgundy bottom bar)
//
//  The one copyright line: on its own, the page's contentinfo
//  landmark with nothing interactive in it; inside the App
//  shell, the last thing on the page — after the tool, and
//  also on a path that matches no route. (The route sweep
//  checks it survives every backend failure of every route.)
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderPage, renderApp } from '../support/render';
import { chainShown, pageTitle } from '../support/reorg-attack/page';
import Footer from '@/components/Footer';


const COPYRIGHT = 'Copyright © | All Rights Reserved | VUKnF';

// DOM order is reading order: a before b
const precedes = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);







// -----------------------------------------------------------
// On its own
// -----------------------------------------------------------

describe('Footer', () => {

  it('is the contentinfo landmark carrying the copyright line', () => {
    renderPage(<Footer />);
    expect(screen.getByRole('contentinfo')).toHaveTextContent(COPYRIGHT);
  });


  it('says exactly the copyright line, with nothing to click', () => {
    renderPage(<Footer />);
    const footer = screen.getByRole('contentinfo');
    expect(footer.textContent.trim()).toBe(COPYRIGHT);
    expect(within(footer).queryAllByRole('link')).toEqual([]);
    expect(within(footer).queryAllByRole('button')).toEqual([]);
  });
});







// -----------------------------------------------------------
// In the App shell
// -----------------------------------------------------------

describe('Footer in the App shell', () => {

  it('closes the page: one footer, after the tool', async () => {
    renderApp({ route: '/reorgattack' });
    await chainShown();
    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent(COPYRIGHT);
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
    expect(precedes(pageTitle(), footer)).toBe(true);
  });


  it('stays on a path that matches no route', () => {
    renderApp({ route: '/nieko/nera' });
    expect(screen.getByRole('contentinfo')).toHaveTextContent(COPYRIGHT);
  });
});
