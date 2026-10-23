// -----------------------------------------------------------
//  [*] Test support — reaching into the 51% attack page
//
//  How the tests find what a student sees on the attack page:
//  the page and its three states, the fork diagram's block
//  cards (their colour, place and parts) and the edges between
//  them, the control panel's sections, and the toasts the
//  actions leave. Everything is found by its role, its
//  Lithuanian label or the block's own hash; the few places
//  the behaviour LIVES in a style — a card's colour, an edge's
//  colour, a block's place on the diagram, whether the panel
//  is slid in — are read from the computed style, the way the
//  student's browser shows them.
//
//  Split into:
//
//    COLORS / NAMED     — the diagram's red and blue and the
//                         tracking palette, as the browser
//                         reports them
//    renderReorgPage …  — the page and its three states
//    blockCards …       — the diagram's block cards
//    clickInDiagram     — a click d3-zoom can take
//    edges / edgeColor  — the links between the cards
//    panel …            — the control panel and its sections
//    toasts / findToast — the action toasts
//
//  Used by:
//    - tests/pages/reorg-attack/* — the page's own tests
//    - core/smoke.test.jsx, core/app.test.jsx,
//      components/footer.test.jsx, contract/route-sweep.test.jsx
//      — the page inside the App
// -----------------------------------------------------------

import { expect } from 'vitest';
import { createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderPage } from '../render';
import ReorgAttackPage from '@/pages/ReorgAttack/Page';


// The two colours of the diagram, in the form getComputedStyle
// reports them: a card is the colour at 30 % over the grey, an
// edge the full colour
export const COLORS = {
  attackerCard: 'rgba(244, 67, 54, 0.3)',
  honestCard: 'rgba(33, 150, 243, 0.3)',
  attackerEdge: 'rgb(244, 67, 54)',
  honestEdge: 'rgb(33, 150, 243)',
};

// The tracking palette's named colours as the browser
// reports them — a coin or a colour dot is painted in one
export const NAMED = {
  red: 'rgb(255, 0, 0)',
  green: 'rgb(0, 128, 0)',
  blue: 'rgb(0, 0, 255)',
  orange: 'rgb(255, 165, 0)',
  purple: 'rgb(128, 0, 128)',
  pink: 'rgb(255, 192, 203)',
  cyan: 'rgb(0, 255, 255)',
  yellow: 'rgb(255, 255, 0)',
};







// -----------------------------------------------------------
// The page and its states
// -----------------------------------------------------------
//
// renderReorgPage mounts the page as App routes it.
// chainShown waits for a block of the given height — the
// default chain's newest unless the test names another;
// loadingShown and failureShown find the other two states,
// and headerBadges reads the scoreboard under the title.
//
// Used by:
//   - the page and control panel tests
//   - core/smoke.test.jsx, core/app.test.jsx,
//     components/footer.test.jsx, contract/route-sweep.test.jsx
// -----------------------------------------------------------

export const renderReorgPage = () => renderPage(<ReorgAttackPage />, { route: '/reorgattack' });

export const pageTitle = () => screen.queryByRole('heading', { level: 5, name: '51% Atakos Įrankis' });

export const chainShown = async (height = 6403) => (await screen.findAllByRole('heading', { level: 6, name: `Block ${height}` }))[0];

export const loadingShown = () => screen.queryByText('Kraunami blokų grandinės duomenys…');

export const FAILURE_HEADLINE = 'Nepavyko užkrauti blokų grandinės duomenų:';

export const failureShown = () => screen.findByText((_, element) => element?.getAttribute('role') === 'alert' && element.textContent.startsWith(FAILURE_HEADLINE));

// The two tip heights, in the order the scoreboard shows them
export const headerBadges = () => {
  const title = pageTitle();
  if (!title) return [];
  return [...title.parentElement.querySelectorAll('p')].map((badge) => badge.textContent);
};







// -----------------------------------------------------------
// The diagram's block cards
// -----------------------------------------------------------
//
// A block's card is its "Block <height>" heading's parent;
// blockCard finds the one a fixture block is, by its height
// and the start of its hash (the card shows the first fifteen
// characters). cardColor is the card's background; cardPlace
// the position ReactFlow put it at (the translate of the box
// it wraps the card in); cardField the text after one of the
// card's bold labels; coinsOf the colour of every
// tracked-transaction coin on it.
//
// Used by:
//   - pages/reorg-attack/fork-diagram.test.jsx
//   - the page tests, core/smoke.test.jsx, core/app.test.jsx
//     — blockCards, to count the drawn blocks
// -----------------------------------------------------------

export const blockCards = () => screen.queryAllByRole('heading', { level: 6, name: /^Block \S+$/ }).map((heading) => heading.parentElement);

export function blockCard(block) {
  const card = blockCards().find((candidate) => (
    within(candidate).queryByRole('heading', { level: 6, name: `Block ${block.height}` })
    && candidate.textContent.includes(block.hash.slice(0, 15))
  ));
  if (!card) throw new Error(`no card for block ${block.height} (${block.hash.slice(0, 15)}…)`);
  return card;
}

export const cardColor = (card) => getComputedStyle(card).backgroundColor;

export function cardPlace(card) {
  const [, x, y] = card.parentElement.style.transform.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/) ?? [];
  return { x: Number(x), y: Number(y) };
}

export function cardField(card, label) {
  const bold = within(card).getByText(label, { selector: 'b' });
  return bold.parentElement.textContent.slice(label.length).replace(/\s+/g, ' ').trim();
}

export const coinsOf = (card) => within(card).queryAllByTestId('AttachMoneyIcon').map((icon) => getComputedStyle(icon.parentElement).backgroundColor);







// -----------------------------------------------------------
// clickInDiagram
// -----------------------------------------------------------
//
// A click inside the diagram. ReactFlow pans with d3-zoom,
// which reads event.view.document on every mousedown there —
// a click on a block included. A browser gives every event
// its window as the view; user-event leaves it null (fixed on
// each event, past changing), so the press, the release and
// the click are built here and handed the document's window
// as their view before they are dispatched (jsdom's own
// constructor refuses the window vitest exposes).
//
// Used by:
//   - pages/reorg-attack/fork-diagram.test.jsx — opening a
//     block's details
// -----------------------------------------------------------

export function clickInDiagram(element) {
  const view = element.ownerDocument.defaultView;
  for (const type of ['mouseDown', 'mouseUp', 'click']) {
    const event = createEvent[type](element, { button: 0 });
    Object.defineProperty(event, 'view', { value: view });
    fireEvent(element, event);
  }
}







// -----------------------------------------------------------
// edges / edgeColor
// -----------------------------------------------------------
//
// ReactFlow names every edge after the two blocks it joins,
// the newer one first. edges lists them, each with the two
// hashes and the colour of the stroke the line is drawn in;
// edgeColor is that colour for the edge between two fixture
// blocks, or nothing when there is no such edge.
//
// Used by:
//   - pages/reorg-attack/fork-diagram.test.jsx
// -----------------------------------------------------------

export const edges = () => screen.queryAllByRole('button', { name: /^Edge from \S+ to \S+$/ }).map((edge) => {
  const [, from, to] = edge.getAttribute('aria-label').match(/^Edge from (\S+) to (\S+)$/);
  return { from, to, color: edge.querySelector('path').style.stroke };
});

export const edgeColor = (from, to) => edges().find((edge) => edge.from === from.hash && edge.to === to.hash)?.color;







// -----------------------------------------------------------
// The control panel
// -----------------------------------------------------------
//
// The panel slides in from the right: it is always in the
// page and only its `right` moves — panelIsOpen reads that,
// and openPanel clicks the gear and waits for it. Slid out it
// is hidden, and a hidden element has no accessible name, so
// the panel is found by its heading's text. The sections are
// found by their headings, a tracked row by the first twelve
// characters of its txid, the icon buttons by their names;
// pickColor chooses a colour in a section's dropdown by the
// name its option shows.
//
// Used by:
//   - pages/reorg-attack/control-panel.test.jsx
//   - core/app.test.jsx — openPanel and attackSwitch, for the
//     toast under StrictMode
// -----------------------------------------------------------

export const panel = () => screen.getByText('Valdymo Skydas', { selector: 'h6' }).parentElement.parentElement;

export const panelIsOpen = () => getComputedStyle(panel()).right === '0px';

export const gearButton = () => screen.getByRole('button', { name: 'Valdymo skydas' });

export async function openPanel(user) {
  await user.click(gearButton());
  await waitFor(() => expect(panelIsOpen()).toBe(true));
}

export const closeButton = () => within(panel()).getByRole('button', { name: 'Uždaryti valdymo skydą' });

export const attackSwitch = () => within(panel()).getByRole('switch');

export const rawSection = () => within(panel()).getByRole('heading', { level: 6, name: 'Siųsti Transakciją į Privatų Mazgą' }).parentElement;
export const rawField = () => within(rawSection()).getByPlaceholderText('Įveskite transakciją HEX formatu...');
export const sendButton = () => within(rawSection()).getByRole('button', { name: 'Siųsti Transakciją' });

export const trackingSection = () => within(panel()).getByRole('heading', { level: 6, name: 'Transakcijų Sekimas' }).parentElement;
export const txidField = () => within(trackingSection()).getByPlaceholderText('Įveskite transakcijos ID...');
export const addButton = () => within(trackingSection()).getByRole('button', { name: 'Pridėti' });

export const trackedRow = (txid) => within(trackingSection()).getByText(`${txid.slice(0, 12)}...`).parentElement.parentElement.parentElement;
export const removeButton = (txid) => within(trackedRow(txid)).getByRole('button', { name: `Nebesekti transakcijos ${txid.slice(0, 12)}...` });

export async function pickColor(user, section, name) {
  await user.click(within(section).getByRole('combobox'));
  await user.click(await screen.findByRole('option', { name }));
  await waitFor(() => expect(within(section).getByRole('combobox')).toHaveTextContent(name));
}







// -----------------------------------------------------------
// toasts / findToast
// -----------------------------------------------------------
//
// Every toast on screen as its lines — the headline, then
// what is under it (the hook parts them with a line break).
// findToast waits for the toast whose headline it names and
// hands back its lines, failing with every toast on screen
// when that one never comes.
//
// Used by:
//   - pages/reorg-attack/control-panel.test.jsx
//   - core/app.test.jsx — one toast under StrictMode
// -----------------------------------------------------------

const linesOf = (toast) => {
  const lines = [''];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeName === 'BR') lines.push('');
      else if (child.nodeType === Node.TEXT_NODE) lines[lines.length - 1] += child.textContent;
      else walk(child);
    }
  };
  walk(toast);
  return lines.map((line) => line.trim());
};

export const toasts = () => screen.queryAllByRole('status').map(linesOf);

export async function findToast(headline) {
  let found;
  await waitFor(() => {
    found = toasts().find((lines) => lines[0] === headline);
    expect(found, `a toast "${headline}" — on screen: ${JSON.stringify(toasts())}`).toBeTruthy();
  });
  return found;
}
