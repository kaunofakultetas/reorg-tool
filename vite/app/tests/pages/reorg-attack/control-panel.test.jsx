// -----------------------------------------------------------
//  [*] Tests — 51% attack: the control panel
//
//  The sliding panel that drives the attack, through the whole
//  page against the backend double:
//    - sliding: out of view at first — hidden from the
//      keyboard and screen readers too — the gear slides it in
//      and the page makes room, the gear or the ✕ slides it
//      out, the gear stays above it and says whether it is
//      open, the icon buttons are named
//    - the attack switch: what it says detached and attached,
//      and while the status is still being read or could not
//      be (unknown — never "detached"), the network state
//      under it (peers, both tips, a tip that does not
//      answer), switching on and off (the endpoint, the toast,
//      both polls re-read), the switch showing the BACKEND's
//      word rather than the click, a refused toggle, every
//      action locked while one is out
//    - the raw-transaction sender: nothing to send, the hex
//      sent trimmed with its colour, the field cleared, the
//      txid in the toast, the eight colours, a refusal
//    - the tracker: the list (count, the colour dot, the txid
//      cut to twelve characters, in how many blocks), an
//      empty list, adding (trimmed, its colour, cleared),
//      removing (the txid sent as one URL path segment),
//      refusals
//  and the backend contract of the five actions as the panel
//  consumes them — a refusal's reason shown, whatever status
//  it came with.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { given, server, url } from '../../support/backend/server';
import { describeEndpointContract, settle } from '../../support/backend/contract';
import { watchRequests } from '../../support/shell/requests';
import {
  NAMED, addButton, attackSwitch, chainShown, closeButton, findToast, gearButton, openPanel, panel, panelIsOpen,
  pageTitle, pickColor, rawField, rawSection, removeButton, renderReorgPage, sendButton, toasts, trackedRow,
  trackingSection, txidField,
} from '../../support/reorg-attack/page';
import * as f from '../../support/backend/fixtures';


const { T } = f;

const STATUS = '/api/reorgattack/status';
const CHAIN = '/api/reorgattack/blockchain/data';

// The page, loaded, with the panel slid in
async function renderWithPanel() {
  const view = renderReorgPage();
  await chainShown();
  await openPanel(view.user);
  return view;
}

// The status landed: the scoreboard shows the public tip
const statusLanded = () => screen.findByText('Viešas: 6402');

const attached = () => given.json('get', STATUS, f.statusAnswer({ connected: true }));

// A txid pasted into the tracker, the way students bring one
async function pasteTxid(user, txid) {
  await user.click(txidField());
  await user.paste(txid);
}

// How many times a path was asked, among the requests seen
const times = (seen, request) => seen.filter((entry) => entry === request).length;

// A page whose root pads itself while the panel is out
const pageRoot = () => pageTitle().parentElement.parentElement;

// What the panel's status block says, line by line
const statusLines = () => [...within(panel()).getByText('Tinklų Būsena:').nextSibling.children].map((line) => line.textContent);

// The refusal a node sends back for a transaction it will not
// take, as the backend wraps it
const NODE_REFUSES = "Failed to send transaction: RPC Error: {'code': -26, 'message': 'bad-txns-inputs-missingorspent'}";







// -----------------------------------------------------------
// Sliding in and out
// -----------------------------------------------------------

describe('Control panel — sliding in and out', () => {

  it('starts out of view, the gear button in the corner', async () => {
    renderReorgPage();
    await chainShown();
    expect(panelIsOpen()).toBe(false);
    expect(gearButton()).toBeInTheDocument();
  });


  it('the gear slides it in, and the page makes room for it beside the diagram', async () => {
    const { user } = renderReorgPage();
    await chainShown();
    expect(getComputedStyle(pageRoot()).paddingRight).toBe('16px');
    await user.click(gearButton());
    await waitFor(() => expect(panelIsOpen()).toBe(true));
    expect(getComputedStyle(pageRoot()).paddingRight).toBe('370px');
  });


  it('the panel\'s own ✕ slides it back out, and so does the gear', async () => {
    const { user } = await renderWithPanel();
    await user.click(closeButton());
    await waitFor(() => expect(panelIsOpen()).toBe(false));
    expect(getComputedStyle(pageRoot()).paddingRight).toBe('16px');

    await openPanel(user);
    await user.click(gearButton());
    await waitFor(() => expect(panelIsOpen()).toBe(false));
  });


  it('keeps the gear above the panel, so it can close it while it is out', async () => {
    await renderWithPanel();
    expect(Number(getComputedStyle(gearButton()).zIndex)).toBeGreaterThan(Number(getComputedStyle(panel()).zIndex));
  });


  it('slid out of view, the panel is out of the keyboard\'s reach and hidden from screen readers', async () => {
    const { user } = renderReorgPage();
    await chainShown();
    expect(panelIsOpen()).toBe(false);
    expect(getComputedStyle(panel()).visibility).toBe('hidden');
    expect(screen.queryByRole('switch')).toBeNull();

    const focusedInside = [];
    for (let stop = 0; stop < 30; stop += 1) {
      await user.tab();
      if (panel().contains(document.activeElement)) focusedInside.push(document.activeElement);
    }
    expect(focusedInside).toEqual([]);
  });


  it('slid in, its controls are back in the keyboard\'s reach', async () => {
    const { user } = await renderWithPanel();
    expect(getComputedStyle(panel()).visibility).toBe('visible');
    let reached = false;
    for (let stop = 0; stop < 30 && !reached; stop += 1) {
      await user.tab();
      reached = panel().contains(document.activeElement);
    }
    expect(reached).toBe(true);
  });


  it('the gear says whether the panel it controls is open', async () => {
    const { user } = renderReorgPage();
    await chainShown();
    expect(gearButton()).toHaveAttribute('aria-expanded', 'false');
    expect(gearButton()).toHaveAttribute('aria-controls', panel().id);

    await openPanel(user);
    expect(gearButton()).toHaveAttribute('aria-expanded', 'true');
  });


  it('names its icon buttons — the ✕ and each tracked row\'s remove', async () => {
    await renderWithPanel();
    expect(closeButton()).toHaveAccessibleName('Uždaryti valdymo skydą');
    expect(removeButton(T.spend)).toHaveAccessibleName('Nebesekti transakcijos 71b9c0a942dc...');
    for (const { txid } of f.TRACKED) expect(removeButton(txid)).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// The attack switch — what it says
// -----------------------------------------------------------

describe('Control panel — the attack switch says where the node is', () => {

  it('detached: off, saying so, with a warning that the node runs privately', async () => {
    await renderWithPanel();
    await statusLanded();
    expect(attackSwitch()).not.toBeChecked();
    expect(attackSwitch()).toHaveAccessibleName('Atjungę nuo viešo tinklo');
    expect(within(panel()).getByRole('alert')).toHaveTextContent('Mazgas operuoja privačiai');
  });


  it('attached: on, saying so, the node running publicly', async () => {
    attached();
    await renderWithPanel();
    await waitFor(() => expect(attackSwitch()).toBeChecked());
    expect(attackSwitch()).toHaveAccessibleName('Prisijungę prie viešo tinklo');
    expect(within(panel()).getByRole('alert')).toHaveTextContent('Mazgas operuoja viešai');
  });


  it('lists the network state: the peer count and both tips\' heights, each answering', async () => {
    await renderWithPanel();
    await statusLanded();
    const lines = statusLines();
    expect(lines).toContain('Peers: 0');
    expect(lines).toContain('Viešo tinklo viršūnės aukštis: 6402 ✅');
    expect(lines).toContain('Privataus mazgo viršūnės aukštis: 6403 ✅');
  });


  it('counts the public node among the peers once attached', async () => {
    attached();
    await renderWithPanel();
    await waitFor(() => expect(statusLines()).toContain('Peers: 1'));
  });


  it('crosses out a tip whose node did not answer', async () => {
    given.json('get', STATUS, f.statusAnswer({ publicTip: { available: false, hash: '', height: 6402 } }));
    await renderWithPanel();
    await waitFor(() => expect(statusLines()).toContain('Viešo tinklo viršūnės aukštis: 6402 ❌'));
    expect(statusLines()).toContain('Privataus mazgo viršūnės aukštis: 6403 ✅');
  });


  it('reads N/A for a tip the backend could not read at all', async () => {
    // The backend's answer for a silent public node
    given.json('get', STATUS, f.statusAnswer({ publicTip: { available: false, hash: null, height: null } }));
    await renderWithPanel();
    await waitFor(() => expect(statusLines()).toContain('Viešo tinklo viršūnės aukštis: N/A ❌'));
  });


  it('while the status is still being read, the switch waits and says so', async () => {
    given.hang('get', STATUS);
    await renderWithPanel();
    expect(attackSwitch()).toBeDisabled();
    expect(attackSwitch()).not.toBeChecked();
    expect(attackSwitch()).toHaveAccessibleName('Mazgo būsena nežinoma');
    expect(within(panel()).getByRole('alert')).toHaveTextContent('Tikrinama mazgo būsena…');
  });


  it('a status that could not be read is said so with its reason — never as "detached"', async () => {
    attached();
    given.error('get', STATUS, "Failed to get network status: RPC Connection Error: HTTPConnectionPool(host='reorg-knfcoind-private', port=19332): Read timed out.");
    await renderWithPanel();
    await waitFor(() => expect(within(panel()).getByRole('alert')).toHaveTextContent(
      "Nepavyko gauti mazgo būsenos: Failed to get network status: RPC Connection Error: HTTPConnectionPool(host='reorg-knfcoind-private', port=19332): Read timed out."));
    expect(attackSwitch()).toBeDisabled();
    expect(attackSwitch()).toHaveAccessibleName('Mazgo būsena nežinoma');
    expect(within(panel()).queryByText('Mazgas operuoja privačiai')).toBeNull();
    expect(within(panel()).queryByText('Atjungę nuo viešo tinklo')).toBeNull();
  });


  it('a status read that fails without a reason says what failed', async () => {
    given.html('get', STATUS);
    await renderWithPanel();
    await waitFor(() => expect(within(panel()).getByRole('alert')).toHaveTextContent('Nepavyko gauti mazgo būsenos: Request failed with status code 500'));
  });
});







// -----------------------------------------------------------
// The attack switch — flipping it
// -----------------------------------------------------------

describe('Control panel — flipping the attack switch', () => {

  it('switching on asks the backend to connect, says so, and re-reads the chain and the status', async () => {
    const seen = watchRequests();
    const { user } = await renderWithPanel();
    await statusLanded();
    await user.click(attackSwitch());

    expect(await findToast('Prisijungta prie viešo tinklo')).toEqual(['Prisijungta prie viešo tinklo']);
    expect(seen).toContain('GET /api/reorgattack/connect');
    expect(seen).not.toContain('GET /api/reorgattack/disconnect');
    await waitFor(() => expect(times(seen, `GET ${CHAIN}`)).toBe(2));
    await waitFor(() => expect(times(seen, `GET ${STATUS}`)).toBe(2));
  });


  it('switching off asks the backend to disconnect, and says so', async () => {
    attached();
    const seen = watchRequests();
    const { user } = await renderWithPanel();
    await waitFor(() => expect(attackSwitch()).toBeChecked());
    await user.click(attackSwitch());

    expect(await findToast('Atjungta nuo viešo tinklo')).toEqual(['Atjungta nuo viešo tinklo']);
    expect(seen).toContain('GET /api/reorgattack/disconnect');
    expect(seen).not.toContain('GET /api/reorgattack/connect');
  });


  it('turns on when the re-read status says attached — the switch shows the backend\'s word', async () => {
    given.sequence('get', STATUS, [{ body: f.statusAnswer() }, { body: f.statusAnswer({ connected: true }) }]);
    const { user } = await renderWithPanel();
    await statusLanded();
    await user.click(attackSwitch());

    await waitFor(() => expect(attackSwitch()).toBeChecked());
    expect(attackSwitch()).toHaveAccessibleName('Prisijungę prie viešo tinklo');
  });


  it('stays off when the backend still reports the node detached after the connect — nothing flips on the click alone', async () => {
    const { user } = await renderWithPanel();
    await statusLanded();
    await user.click(attackSwitch());

    await findToast('Prisijungta prie viešo tinklo');
    await settle(100);
    expect(attackSwitch()).not.toBeChecked();
  });


  it('a refused toggle says why, and leaves the switch and the chain as they were', async () => {
    given.json('get', '/api/reorgattack/connect', { message: 'RPC Error: {\'code\': -24, \'message\': \'Error: Node already added\'}', success: false });
    const seen = watchRequests();
    const { user } = await renderWithPanel();
    await statusLanded();
    await user.click(attackSwitch());

    expect(await findToast('Prisijungimo operacija nepavyko')).toEqual(['Prisijungimo operacija nepavyko', 'RPC Error: {\'code\': -24, \'message\': \'Error: Node already added\'}']);
    await settle(100);
    expect(attackSwitch()).not.toBeChecked();
    expect(times(seen, `GET ${CHAIN}`)).toBe(1);
  });


  it('locks every action while the switch is working: the switch, the send, the add and every remove', async () => {
    given.hang('get', '/api/reorgattack/connect');
    const { user } = await renderWithPanel();
    await statusLanded();
    await user.click(rawField());
    await user.paste(f.RAW_TX);
    await pasteTxid(user, f.NEW_TXID);
    expect(sendButton()).toBeEnabled();
    expect(addButton()).toBeEnabled();

    await user.click(attackSwitch());
    await waitFor(() => expect(attackSwitch()).toBeDisabled());
    expect(sendButton()).toBeDisabled();
    expect(addButton()).toBeDisabled();
    for (const { txid } of f.TRACKED) expect(removeButton(txid)).toBeDisabled();
  });
});







// -----------------------------------------------------------
// The raw-transaction sender
// -----------------------------------------------------------

describe('Control panel — sending a raw transaction into the private node', () => {

  it('waits for something to send — blanks are nothing', async () => {
    const { user } = await renderWithPanel();
    expect(sendButton()).toBeDisabled();
    await user.type(rawField(), '   ');
    expect(sendButton()).toBeDisabled();
    await user.type(rawField(), '02000000');
    expect(sendButton()).toBeEnabled();
  });


  it('sends the hex, trimmed, in red unless told otherwise — clears the field and names the txid the node gave it', async () => {
    const calls = given.capture('post', '/api/reorgattack/transactions/send', f.sendAnswer());
    const seen = watchRequests();
    const { user } = await renderWithPanel();
    await user.click(rawField());
    await user.paste(`  ${f.RAW_TX}\n`);
    await user.click(sendButton());

    expect(await findToast('Transakcija sėkmingai išsiųsta!')).toEqual(['Transakcija sėkmingai išsiųsta!', `TXID: ${f.SENT_TXID}`]);
    expect(calls.map((call) => call.body)).toEqual([{ raw_transaction: f.RAW_TX, color: 'red' }]);
    expect(rawField()).toHaveValue('');
    await waitFor(() => expect(times(seen, `GET ${CHAIN}`)).toBe(2));
  });


  it('sends the colour picked', async () => {
    const calls = given.capture('post', '/api/reorgattack/transactions/send', f.sendAnswer());
    const { user } = await renderWithPanel();
    await pickColor(user, rawSection(), 'Blue');
    await user.click(rawField());
    await user.paste(f.RAW_TX);
    await user.click(sendButton());

    await findToast('Transakcija sėkmingai išsiųsta!');
    expect(calls[0].body.color).toBe('blue');
  });


  it('offers the eight tracking colours by name, each with its dot', async () => {
    const { user } = await renderWithPanel();
    expect(within(rawSection()).getByRole('combobox')).toHaveTextContent('Red');
    await user.click(within(rawSection()).getByRole('combobox'));
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Red', 'Green', 'Blue', 'Orange', 'Purple', 'Pink', 'Cyan', 'Yellow']);
    const purpleDot = within(options[4]).getByText('Purple').firstChild;
    expect(getComputedStyle(purpleDot).backgroundColor).toBe(NAMED.purple);
  });


  it('a refused transaction says why under "Nepavyko išsiųsti transakcijos"', async () => {
    given.json('post', '/api/reorgattack/transactions/send', { message: NODE_REFUSES, success: false });
    const { user } = await renderWithPanel();
    await user.click(rawField());
    await user.paste(f.RAW_TX);
    await user.click(sendButton());

    expect(await findToast('Nepavyko išsiųsti transakcijos')).toEqual(['Nepavyko išsiųsti transakcijos', NODE_REFUSES]);
  });


  it('clears the field as soon as the send is away — also when the node then refuses it', async () => {
    given.json('post', '/api/reorgattack/transactions/send', { message: NODE_REFUSES, success: false });
    const { user } = await renderWithPanel();
    await user.click(rawField());
    await user.paste(f.RAW_TX);
    await user.click(sendButton());

    expect(rawField()).toHaveValue('');
    await findToast('Nepavyko išsiųsti transakcijos');
    expect(rawField()).toHaveValue('');
  });
});







// -----------------------------------------------------------
// The tracker — the list
// -----------------------------------------------------------

describe('Control panel — the tracked transactions', () => {

  it('counts them', async () => {
    await renderWithPanel();
    expect(within(trackingSection()).getByText('Sekamos Transakcijos (4)')).toBeInTheDocument();
  });


  it('shows each with its colour dot, its txid cut to twelve characters, and in how many blocks it was found', async () => {
    await renderWithPanel();
    expect(trackedRow(T.spend)).toHaveTextContent(/^71b9c0a942dc\.\.\.Rasta 1 blokuose$/);
    expect(trackedRow(T.both)).toHaveTextContent(/^19cde07d6de7\.\.\.Rasta 2 blokuose$/);
    expect(trackedRow(T.pending)).toHaveTextContent(/^ce5aafdca291\.\.\.Nerasta nei viename bloke$/);

    const dot = (txid) => within(trackedRow(txid)).getByText(`${txid.slice(0, 12)}...`).previousSibling;
    expect(getComputedStyle(dot(T.spend)).backgroundColor).toBe(NAMED.red);
    expect(getComputedStyle(dot(T.double)).backgroundColor).toBe(NAMED.blue);
    expect(getComputedStyle(dot(T.pending)).backgroundColor).toBe(NAMED.orange);
  });


  it('says when nothing is tracked', async () => {
    given.json('get', CHAIN, f.chainData({ transactions: [] }));
    await renderWithPanel();
    expect(within(trackingSection()).getByText('Sekamos Transakcijos (0)')).toBeInTheDocument();
    expect(within(trackingSection()).getByText('Nesekama nei viena transakcija')).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// The tracker — adding and removing
// -----------------------------------------------------------

describe('Control panel — tracking and untracking', () => {

  it('the add button waits for a txid — blanks are none', async () => {
    const { user } = await renderWithPanel();
    expect(addButton()).toBeDisabled();
    await user.type(txidField(), '  ');
    expect(addButton()).toBeDisabled();
    await user.type(txidField(), 'c9ce37');
    expect(addButton()).toBeEnabled();
  });


  it('adds the txid, trimmed, in green unless told otherwise — clears the field, says so, re-reads the chain', async () => {
    const calls = given.capture('post', '/api/reorgattack/transactions', ({ sent }) => f.trackAnswer(sent.txid, sent.color), { status: 201 });
    const seen = watchRequests();
    const { user } = await renderWithPanel();
    await pasteTxid(user, `  ${f.NEW_TXID} `);
    await user.click(addButton());

    expect(await findToast('Transakcija pridėta į sekamų sąrašą')).toEqual(['Transakcija pridėta į sekamų sąrašą']);
    expect(calls.map((call) => call.body)).toEqual([{ txid: f.NEW_TXID, color: 'green' }]);
    expect(txidField()).toHaveValue('');
    await waitFor(() => expect(times(seen, `GET ${CHAIN}`)).toBe(2));
  });


  it('sends the colour picked', async () => {
    const calls = given.capture('post', '/api/reorgattack/transactions', ({ sent }) => f.trackAnswer(sent.txid, sent.color), { status: 201 });
    const { user } = await renderWithPanel();
    await pickColor(user, trackingSection(), 'Purple');
    await pasteTxid(user, f.NEW_TXID);
    await user.click(addButton());

    await findToast('Transakcija pridėta į sekamų sąrašą');
    expect(calls[0].body).toEqual({ txid: f.NEW_TXID, color: 'purple' });
  });


  it('removing asks the backend to stop tracking that txid, says so, and re-reads the chain', async () => {
    const calls = given.capture('delete', '/api/reorgattack/transactions/:txid', f.untrackAnswer());
    const seen = watchRequests();
    const { user } = await renderWithPanel();
    await user.click(removeButton(T.pending));

    expect(await findToast('Transakcija pašalinta iš sekamų sąrašo')).toEqual(['Transakcija pašalinta iš sekamų sąrašo']);
    expect(calls.map((call) => call.params.txid)).toEqual([T.pending]);
    await waitFor(() => expect(times(seen, `GET ${CHAIN}`)).toBe(2));
  });


  it('a refused add says why under "Nepavyko pridėti transakcijos"', async () => {
    given.json('post', '/api/reorgattack/transactions', { message: 'database is locked', success: false });
    const { user } = await renderWithPanel();
    await pasteTxid(user, f.NEW_TXID);
    await user.click(addButton());

    expect(await findToast('Nepavyko pridėti transakcijos')).toEqual(['Nepavyko pridėti transakcijos', 'database is locked']);
  });


  it('a refused remove says why under "Nepavyko pašalinti transakcijos"', async () => {
    given.json('delete', '/api/reorgattack/transactions/:txid', { message: 'database is locked', success: false });
    const { user } = await renderWithPanel();
    await user.click(removeButton(T.spend));

    expect(await findToast('Nepavyko pašalinti transakcijos')).toEqual(['Nepavyko pašalinti transakcijos', 'database is locked']);
  });


  it('removing sends the txid as one URL path segment, whatever characters it holds', async () => {
    // Today the backend only tracks txids a node knows — plain
    // hex — but the path must never depend on that
    const pasted = `https://knfcoin.knf.vu.lt/explorer/tx/${T.spend}`;
    given.json('get', CHAIN, f.chainData({ transactions: [{ blocks: [], color: 'green', txid: pasted }] }));
    const paths = [];
    server.use(http.delete(url('/api/reorgattack/transactions/*'), ({ request }) => {
      paths.push(new URL(request.url).pathname);
      return HttpResponse.json(f.untrackAnswer());
    }));
    const { user } = await renderWithPanel();
    await user.click(removeButton(pasted));

    await waitFor(() => expect(paths).toHaveLength(1));
    expect(paths[0]).toBe(`/api/reorgattack/transactions/${encodeURIComponent(pasted)}`);
  });
});







// -----------------------------------------------------------
// The backend contract of the five actions
// -----------------------------------------------------------
//
// Each action is triggered the way a student does it, then
// answered every way the matrix knows. A failure must reach
// the student as the action's error toast — the backend's
// reason under the headline when the answer carried one, some
// reason in any case; a success as the action's toast; and
// while the answer is out, every action waits.
// -----------------------------------------------------------

// The action's error toast: its headline, then the reason
const failedWith = (headline) => async (reason) => {
  const lines = await findToast(headline);
  if (reason) expect(lines[1]).toBe(reason);
  else expect(lines[1]).toMatch(/\S/);
};

// The panel and the page are still there
const chrome = () => pageTitle() && panel() && attackSwitch();

// The actions never read the chain: their matrices draw a
// one-block one, which renders in a fraction of the time
async function renderForAction() {
  given.json('get', CHAIN, f.chainData({ blocks: [f.B.p6403] }));
  const view = await renderWithPanel();
  await statusLanded();
  return view;
}

// While an action's answer is out: the switch is locked
const locked = () => attackSwitch().disabled;

describeEndpointContract({
  path: '/api/reorgattack/connect',
  fixture: f.connectAnswer(),
  render: async () => {
    const { user } = await renderForAction();
    await user.click(attackSwitch());
  },
  chrome,
  loaded: () => findToast('Prisijungta prie viešo tinklo'),
  failed: failedWith('Prisijungimo operacija nepavyko'),
  loading: locked,
});

describeEndpointContract({
  path: '/api/reorgattack/disconnect',
  fixture: f.disconnectAnswer(),
  render: async () => {
    attached();
    const { user } = await renderForAction();
    await waitFor(() => expect(attackSwitch()).toBeChecked());
    await user.click(attackSwitch());
  },
  chrome,
  loaded: () => findToast('Atjungta nuo viešo tinklo'),
  failed: failedWith('Prisijungimo operacija nepavyko'),
  loading: locked,
});

describeEndpointContract({
  path: '/api/reorgattack/transactions/send',
  method: 'post',
  fixture: f.sendAnswer(),
  render: async () => {
    const { user } = await renderForAction();
    await user.click(rawField());
    await user.paste(f.RAW_TX);
    await user.click(sendButton());
  },
  chrome,
  loaded: async () => expect(await findToast('Transakcija sėkmingai išsiųsta!')).toEqual(['Transakcija sėkmingai išsiųsta!', `TXID: ${f.SENT_TXID}`]),
  failed: failedWith('Nepavyko išsiųsti transakcijos'),
  loading: locked,
});

describeEndpointContract({
  path: '/api/reorgattack/transactions',
  method: 'post',
  fixture: f.trackAnswer(),
  render: async () => {
    const { user } = await renderForAction();
    await pasteTxid(user, f.NEW_TXID);
    await user.click(addButton());
  },
  chrome,
  loaded: () => findToast('Transakcija pridėta į sekamų sąrašą'),
  failed: failedWith('Nepavyko pridėti transakcijos'),
  loading: locked,
});

describeEndpointContract({
  path: '/api/reorgattack/transactions/:txid',
  method: 'delete',
  fixture: f.untrackAnswer(),
  render: async () => {
    const { user } = await renderForAction();
    await user.click(removeButton(T.pending));
  },
  chrome,
  loaded: () => findToast('Transakcija pašalinta iš sekamų sąrašo'),
  failed: failedWith('Nepavyko pašalinti transakcijos'),
  loading: locked,
});


// The matrix leaves the toasts of the 'survives' variants
// unread; this one checks the hostile txid in a success toast
// stays text
describe('Control panel — a hostile txid in the send answer', () => {

  it('is shown as text in the toast, never as markup', async () => {
    given.json('post', '/api/reorgattack/transactions/send', f.sendAnswer('<img src=x onerror=alert(1)>'));
    const { user } = await renderWithPanel();
    await user.click(rawField());
    await user.paste(f.RAW_TX);
    await user.click(sendButton());

    expect(await findToast('Transakcija sėkmingai išsiųsta!')).toEqual(['Transakcija sėkmingai išsiųsta!', 'TXID: <img src=x onerror=alert(1)>']);
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(toasts()).toHaveLength(1);
  });
});
