// -----------------------------------------------------------
//  [*] Tests — 51% attack: the fork diagram (ReactFlowBlockchain)
//
//  The diagram as the student sees it, drawn by the real
//  ReactFlow on jsdom (setup.js gives it the measurements it
//  needs):
//    - one card per block, saying its height, its hash cut to
//      the first and last fifteen characters, its coinbase
//      (thirty characters at most), its time on the student's
//      clock (a dash when it came without one), its
//      accumulated work to six decimals, and a coin per
//      tracked transaction found in it, in that transaction's
//      colour
//    - the colours: every "Public Miner" block and the edge
//      out of it blue, every other block and edge red — the
//      stack's own "/VU KNF/" stratum included — and every
//      edge a still, solid line
//    - the layout: newest on top; while the tips differ,
//      each node's own blocks on its lane beside the centred
//      history from the very first one — the public node's
//      left, the private node's right, a side with none yet
//      left empty; once both nodes are on one tip, their
//      chain down the centre and the other fork out to its
//      side; the opening view with the centre lane down the
//      middle of the frame
//    - the two tip badges, the glowing work of the block with
//      the most — of both tips while the forks are level —
//      and the glow moving when the work does
//    - an empty chain, a block it cannot place (no hash) left
//      out, the zoom controls, a click opening the block's
//      details
//  The diagram is rendered on its own, fed like the page feeds
//  it; the page tests cover the wiring to the backend.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderPage } from '../../support/render';
import {
  COLORS, NAMED, blockCard, blockCards, cardColor, cardField, cardPlace, clickInDiagram, coinsOf, edgeColor, edges,
} from '../../support/reorg-attack/page';
import * as f from '../../support/backend/fixtures';
import ReactFlowBlockchain from '@/pages/ReorgAttack/components/ReactFlowBlockchain';


const { B } = f;

const renderDiagram = ({ blocks = f.CHAIN, tips = f.TIPS, transactions = f.TRACKED } = {}) => renderPage(
  <ReactFlowBlockchain chainBlocks={blocks} chainTips={tips} transactions={transactions} />
);

const drawn = () => screen.findByRole('heading', { level: 6, name: 'Block 6403' });

// The work bubble of a card: the box around its "Chain Work"
// line
const workBubble = (card) => within(card).getByText(/^Chain Work: /).parentElement;

// The theme's burgundy (the winner) and MUI's grey 400 (every
// other block), as the browser reports them
const GLOWING = 'rgb(120, 0, 63)';
const IDLE = 'rgb(189, 189, 189)';







// -----------------------------------------------------------
// The cards
// -----------------------------------------------------------

describe('Fork diagram — the cards', () => {

  it('draws one card per block — both blocks of each forked height', async () => {
    renderDiagram();
    await drawn();
    expect(blockCards()).toHaveLength(8);
    expect(screen.getAllByRole('heading', { level: 6, name: 'Block 6402' })).toHaveLength(2);
    expect(screen.getAllByRole('heading', { level: 6, name: 'Block 6401' })).toHaveLength(2);
    expect(screen.getAllByRole('heading', { level: 6, name: 'Block 6400' })).toHaveLength(1);
  });


  it('an honest card: the hash cut to its first and last fifteen characters, the whole short coinbase, the date and time on the student\'s clock', async () => {
    renderDiagram();
    await drawn();
    const card = blockCard(B.u6401);
    expect(cardField(card, 'SHA256 Hash:')).toBe('0385c335b4a3418 ... 3044c50019f7673');
    expect(cardField(card, 'Coinbase:')).toBe('/Public Miner/');
    expect(cardField(card, 'Time:')).toBe('2026-10-19 05:15:28');
  });


  it('dates a block mined late in the UTC evening on the student\'s next day', async () => {
    const lateEvening = { ...B.p6403, timestamp: Date.parse('2026-10-19T22:30:05Z') / 1000 };
    renderDiagram({ blocks: [lateEvening] });
    await drawn();
    expect(cardField(blockCard(lateEvening), 'Time:')).toBe('2026-10-20 01:30:05');
  });


  it.each([
    ['no time at all', undefined],
    ['a null', null],
    ['the time as text', '1792376342'],
    ['a number no date can hold', 1e20],
  ])('shows a dash for the time of a block that came with %s', async (_, timestamp) => {
    const block = { ...B.p6403, timestamp };
    renderDiagram({ blocks: [block] });
    await drawn();
    expect(cardField(blockCard(block), 'Time:')).toBe('—');
  });


  it('an attacker card: a coinbase longer than thirty characters is cut, with " ..." after it', async () => {
    renderDiagram();
    await drawn();
    const card = blockCard(B.p6403);
    expect(cardField(card, 'SHA256 Hash:')).toBe('e1bdefb3bcc440a ... 131e394ab599e1c');
    expect(cardField(card, 'Coinbase:')).toBe('/Vardenis Pavardenis ATAKA (20 ...');
  });


  it('shows each block\'s accumulated work to six decimals', async () => {
    renderDiagram();
    await drawn();
    expect(within(blockCard(B.u6401)).getByText('Chain Work: 47.542360')).toBeInTheDocument();
    expect(within(blockCard(B.p6403)).getByText('Chain Work: 47.543280')).toBeInTheDocument();
    expect(within(blockCard(B.s6400)).getByText('Chain Work: 47.541900')).toBeInTheDocument();
  });


  it('leaves the work bubble out for a block that came without its work', async () => {
    const { chainWork: _, ...withoutWork } = B.s6400;
    renderDiagram({ blocks: [withoutWork] });
    await screen.findByRole('heading', { level: 6, name: 'Block 6400' });
    expect(screen.queryByText(/^Chain Work: /)).toBeNull();
  });


  it('puts a coin in a transaction\'s colour on every block it was found in — on both branches for one in both', async () => {
    renderDiagram();
    await drawn();
    expect(coinsOf(blockCard(B.u6401))).toEqual([NAMED.red]);
    expect(coinsOf(blockCard(B.p6402))).toEqual([NAMED.blue]);
    expect(coinsOf(blockCard(B.u6402))).toEqual([NAMED.green]);
    expect(coinsOf(blockCard(B.p6401))).toEqual([NAMED.green]);
    expect(coinsOf(blockCard(B.s6400))).toEqual([]);
    expect(coinsOf(blockCard(B.p6403))).toEqual([]);
  });


  it('one block, two tracked transactions: two coins', async () => {
    const transactions = [...f.TRACKED, { blocks: [B.u6401.hash], color: 'purple', txid: f.NEW_TXID }];
    renderDiagram({ transactions });
    await drawn();
    expect(coinsOf(blockCard(B.u6401))).toEqual([NAMED.red, NAMED.purple]);
  });
});







// -----------------------------------------------------------
// The colours
// -----------------------------------------------------------
//
// The rule the diagram teaches with: blue is the public
// miner's chain — a block whose coinbase carries "Public
// Miner" — and red is everything else.
// -----------------------------------------------------------

describe('Fork diagram — the colours', () => {

  it('paints every "Public Miner" block blue and every other block red', async () => {
    renderDiagram();
    await drawn();
    for (const block of f.CHAIN) {
      const expected = block.coinbase.includes('Public Miner') ? COLORS.honestCard : COLORS.attackerCard;
      expect(cardColor(blockCard(block)), `block ${block.height} (${block.coinbase})`).toBe(expected);
    }
    expect(cardColor(blockCard(B.u6401))).toBe(COLORS.honestCard);
    expect(cardColor(blockCard(B.p6401))).toBe(COLORS.attackerCard);
  });


  it('paints a block of the stack\'s own stratum ("/VU KNF/") red, and any other miner\'s too', async () => {
    const stratum = { ...B.s6400, coinbase: f.STRATUM };
    const stranger = { ...B.s6399, coinbase: '/ViaBTC/Mined by knf-student-07/' };
    renderDiagram({ blocks: [B.p6403, B.u6402, B.p6402, B.u6401, B.p6401, stratum, stranger, B.s6398] });
    await drawn();
    expect(cardColor(blockCard(stratum))).toBe(COLORS.attackerCard);
    expect(cardColor(blockCard(stranger))).toBe(COLORS.attackerCard);
    expect(cardColor(blockCard(B.s6398))).toBe(COLORS.honestCard);
  });


  it('paints a block blue when "Public Miner" is anywhere in its coinbase', async () => {
    const pooled = { ...B.p6403, coinbase: 'pool #2 /Public Miner/' };
    renderDiagram({ blocks: [pooled] });
    await drawn();
    expect(cardColor(blockCard(pooled))).toBe(COLORS.honestCard);
  });


  it('draws every edge as a still, solid line — no running dashes out of the two tips', async () => {
    renderDiagram();
    await drawn();
    await waitFor(() => expect(edges()).toHaveLength(7));
    const drawnEdges = screen.queryAllByRole('button', { name: /^Edge from \S+ to \S+$/ });
    expect(drawnEdges.filter((edge) => edge.classList.contains('animated'))).toEqual([]);
  });


  it('draws every edge in the colour of the newer block: blue out of an honest block, red out of an attacker\'s', async () => {
    renderDiagram();
    await drawn();
    await waitFor(() => expect(edges()).toHaveLength(7));
    expect(edgeColor(B.u6402, B.u6401)).toBe(COLORS.honestEdge);
    expect(edgeColor(B.u6401, B.s6400)).toBe(COLORS.honestEdge);
    expect(edgeColor(B.s6400, B.s6399)).toBe(COLORS.honestEdge);
    expect(edgeColor(B.s6399, B.s6398)).toBe(COLORS.honestEdge);
    expect(edgeColor(B.p6403, B.p6402)).toBe(COLORS.attackerEdge);
    expect(edgeColor(B.p6402, B.p6401)).toBe(COLORS.attackerEdge);
    // the attacker's first block forks off the shared history:
    // its edge is red although it lands on a blue block
    expect(edgeColor(B.p6401, B.s6400)).toBe(COLORS.attackerEdge);
  });
});







// -----------------------------------------------------------
// The layout
// -----------------------------------------------------------

describe('Fork diagram — the layout', () => {

  it('puts the newest block on top and each older height a row lower', async () => {
    renderDiagram();
    await drawn();
    expect(cardPlace(blockCard(B.p6403)).y).toBe(0);
    expect(cardPlace(blockCard(B.u6402)).y).toBe(200);
    expect(cardPlace(blockCard(B.p6402)).y).toBe(200);
    expect(cardPlace(blockCard(B.u6401)).y).toBe(400);
    expect(cardPlace(blockCard(B.s6400)).y).toBe(600);
    expect(cardPlace(blockCard(B.s6398)).y).toBe(1000);
  });


  it('while the nodes are on separate forks, runs each whole fork on its own lane — the public one left, the private one right — over the centred history', async () => {
    renderDiagram();
    await drawn();
    for (const block of [B.u6402, B.u6401]) expect(cardPlace(blockCard(block)).x, `block ${block.height}`).toBe(-250);
    for (const block of [B.p6403, B.p6402, B.p6401]) expect(cardPlace(blockCard(block)).x, `block ${block.height}`).toBe(250);
    for (const block of [B.s6400, B.s6399, B.s6398]) expect(cardPlace(blockCard(block)).x, `block ${block.height}`).toBe(0);
  });


  it('puts the first block only the private node has on its side at once, the public side left empty for the fork to come', async () => {
    renderDiagram({ blocks: [B.p6401, B.s6400, B.s6399, B.s6398], tips: { public: B.s6400.hash, private: B.p6401.hash } });
    await screen.findByRole('heading', { level: 6, name: 'Block 6401' });
    expect(cardPlace(blockCard(B.p6401)).x).toBe(250);
    for (const block of [B.s6400, B.s6399, B.s6398]) expect(cardPlace(blockCard(block)).x, `block ${block.height}`).toBe(0);
    expect(blockCards().filter((card) => cardPlace(card).x < 0)).toEqual([]);
  });


  it('once both nodes are on one tip, runs their chain down the centre and moves the other fork out to its side', async () => {
    renderDiagram({ tips: { public: B.p6403.hash, private: B.p6403.hash } });
    await drawn();
    for (const block of [B.p6403, B.p6402, B.p6401, B.s6400, B.s6398]) expect(cardPlace(blockCard(block)).x, `block ${block.height}`).toBe(0);
    for (const block of [B.u6402, B.u6401]) expect(cardPlace(blockCard(block)).x, `block ${block.height}`).toBe(-500);
  });


  // jsdom measures every card 1 px wide (setup.js), so the
  // centre lane's axis runs half a pixel in from x=0; the
  // frame's width is given before the camera is aimed
  it('opens with the centre lane down the middle of the frame and the newest blocks on top', async () => {
    renderDiagram();
    Object.defineProperty(document.querySelector('.react-flow').parentElement, 'clientWidth', { configurable: true, value: 1200 });
    await drawn();
    await waitFor(() => {
      const transform = document.querySelector('.react-flow__viewport').style.transform;
      const [x, y, zoom] = transform.match(/translate\((-?[\d.]+)px, ?(-?[\d.]+)px\) scale\(([\d.]+)\)/).slice(1).map(Number);
      expect(y).toBe(50);
      expect(x + 0.5 * zoom).toBe(600);
    });
  });
});







// -----------------------------------------------------------
// The tips and the winner
// -----------------------------------------------------------

describe('Fork diagram — the tips and the winner', () => {

  it('badges the public tip "Viešas" and the private tip "Privatus" — no other block', async () => {
    renderDiagram();
    await drawn();
    expect(within(blockCard(B.u6402)).getByRole('heading', { level: 5, name: 'Viešas' })).toBeInTheDocument();
    expect(within(blockCard(B.p6403)).getByRole('heading', { level: 5, name: 'Privatus' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 5, name: 'Viešas' })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 5, name: 'Privatus' })).toHaveLength(1);
  });


  it('puts both badges on one block when the two nodes agree on the tip', async () => {
    renderDiagram({ tips: { public: B.s6400.hash, private: B.s6400.hash } });
    await drawn();
    const card = blockCard(B.s6400);
    expect(within(card).getByRole('heading', { level: 5, name: 'Viešas' })).toBeInTheDocument();
    expect(within(card).getByRole('heading', { level: 5, name: 'Privatus' })).toBeInTheDocument();
  });


  it('lights up the work of the block with the most accumulated work — only that one', async () => {
    renderDiagram();
    await drawn();
    expect(getComputedStyle(workBubble(blockCard(B.p6403))).backgroundColor).toBe(GLOWING);
    for (const block of f.CHAIN.filter((b) => b !== B.p6403)) {
      expect(getComputedStyle(workBubble(blockCard(block))).backgroundColor, `block ${block.height}`).toBe(IDLE);
    }
  });


  it('lights up both tips while the two forks are level — the same height, the same work', async () => {
    const level = f.CHAIN.filter((block) => block !== B.p6403);
    renderDiagram({ blocks: level, tips: { ...f.TIPS, private: B.p6402.hash } });
    await screen.findAllByRole('heading', { level: 6, name: 'Block 6402' });
    expect(getComputedStyle(workBubble(blockCard(B.u6402))).backgroundColor).toBe(GLOWING);
    expect(getComputedStyle(workBubble(blockCard(B.p6402))).backgroundColor).toBe(GLOWING);
    for (const block of level.filter((b) => b !== B.u6402 && b !== B.p6402)) {
      expect(getComputedStyle(workBubble(blockCard(block))).backgroundColor, `block ${block.height}`).toBe(IDLE);
    }
  });


  it('moves the glow when the public branch overtakes — the winner is the work, not the colour', async () => {
    const { rerender } = renderDiagram();
    await drawn();
    const overtaking = { ...B.u6402, chainWork: 47.6 };
    rerender(<ReactFlowBlockchain chainBlocks={[B.p6403, overtaking, B.p6402, B.u6401, B.p6401, B.s6400, B.s6399, B.s6398]} chainTips={f.TIPS} transactions={f.TRACKED} />);
    await waitFor(() => expect(getComputedStyle(workBubble(blockCard(overtaking))).backgroundColor).toBe(GLOWING));
    expect(getComputedStyle(workBubble(blockCard(B.p6403))).backgroundColor).toBe(IDLE);
  });
});







// -----------------------------------------------------------
// The frame around it
// -----------------------------------------------------------

describe('Fork diagram — empty, controls, clicks', () => {

  it('an empty chain says so instead of drawing', () => {
    renderDiagram({ blocks: [] });
    expect(screen.getByRole('heading', { level: 6, name: 'Blokų grandinė tuščia' })).toBeInTheDocument();
    expect(blockCards()).toEqual([]);
    expect(screen.queryByRole('button', { name: 'zoom in' })).toBeNull();
  });


  it('draws a block that came without a coinbase with an empty one, red', async () => {
    const bare = { ...B.u6401, coinbase: null };
    renderDiagram({ blocks: [bare] });
    await screen.findByRole('heading', { level: 6, name: 'Block 6401' });
    expect(cardField(blockCard(bare), 'Coinbase:')).toBe('');
    expect(cardColor(blockCard(bare))).toBe(COLORS.attackerCard);
  });


  it('leaves out a block without a hash and draws the rest', async () => {
    renderDiagram({ blocks: [...f.CHAIN, { ...B.s6398, hash: null, height: 6397 }] });
    await drawn();
    expect(blockCards()).toHaveLength(8);
    expect(screen.queryByRole('heading', { level: 6, name: 'Block 6397' })).toBeNull();
  });


  it('offers zoom in, zoom out and fit view', async () => {
    renderDiagram();
    await drawn();
    for (const name of ['zoom in', 'zoom out', 'fit view']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });


  it('opens the details of the block clicked — an attacker block says so', async () => {
    renderDiagram();
    await drawn();
    clickInDiagram(within(blockCard(B.p6403)).getByRole('heading', { level: 6, name: 'Block 6403' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Bloko Informacija')).toBeInTheDocument();
    expect(within(dialog).getByText('Atakuotojo blokas')).toBeInTheDocument();
    expect(within(dialog).getByText(B.p6403.hash)).toBeInTheDocument();
  });


  it('opens an honest block as honest, and closing the details brings back the diagram', async () => {
    const { user } = renderDiagram();
    await drawn();
    clickInDiagram(within(blockCard(B.u6401)).getByText('Coinbase:'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Sąžiningas blokas')).toBeInTheDocument();
    expect(within(dialog).getByText(B.u6401.hash)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Uždaryti' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(blockCards()).toHaveLength(8);
  });


  it('hands the details the block\'s tracked transactions', async () => {
    renderDiagram();
    await drawn();
    clickInDiagram(within(blockCard(B.p6401)).getByText('Coinbase:'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Sekamos Transakcijos')).toBeInTheDocument();
    expect(within(dialog).getByText(f.T.both)).toBeInTheDocument();
  });
});
