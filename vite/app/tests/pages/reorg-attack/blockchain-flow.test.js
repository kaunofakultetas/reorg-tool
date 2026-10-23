// -----------------------------------------------------------
//  [*] Tests — 51% attack: the fork diagram's flow builders
//
//  The pure functions of blockchainFlow.js, called directly —
//  everything the diagram draws is decided here:
//    - isAttackerBlock: the colour rule — a block is the
//      honest (blue) chain's only when its coinbase carries
//      "Public Miner"; every other coinbase is the attacker's
//      (red): a student's named attack, the stack's own
//      stratum, the extractor's fallbacks, a missing one, one
//      that is not text
//    - isDrawable: a block with a hash, the only kind the
//      diagram can place
//    - groupByHeight, findWinningBlockHashes (the most
//      accumulated work wins — compared as numbers, and every
//      block level on it wins, as both tips of two forks of
//      the same length do)
//    - assignLanes: every fork on a vertical lane of its own.
//      While the nodes are on separate forks, the shared
//      history in the centre and each node's whole fork
//      beside it — the public one left, the private one right
//      — however long it grows; once both are on the same
//      fork, that chain in the centre and the other fork out
//      on its side — honest left, the attacker's right. A node
//      merely ahead of the other has its extra blocks on its
//      side from the first one, the other side kept empty, so
//      nothing moves when the other node's fork appears; one
//      tip or none in view, a gap in the stored blocks, forks
//      that would overlap, blocks listed twice, and parents
//      that loop back
//    - buildNodes: one fixed node per block, newest on top,
//      one row per height, standing on its lane, the flags
//      each card reads (tips, attacker, winner, its
//      transactions)
//    - buildEdges: child → parent for every parent in view,
//      coloured by the child, every one a plain solid line —
//      the tips' edges included
//    - axisCamera: the opening view — the centre lane's axis
//      down the middle of the frame however lopsided the
//      forks, zoomed to fit the side that reaches further,
//      within the zoom limits, the newest row on top
//    - buildBlockchainFlow: the three together, a block it
//      cannot place left out, the caller's list left as it was
//  The fixture chain is the middle of an attack (see
//  fixtures.js): a shared history, a two-block public branch,
//  a three-block private one.
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import * as f from '../../support/backend/fixtures';
import buildBlockchainFlow, {
  assignLanes, axisCamera, buildEdges, buildNodes, findWinningBlockHashes, groupByHeight, isAttackerBlock, isDrawable,
} from '@/pages/ReorgAttack/components/blockchainFlow';


const { B, T } = f;

// A block of the fixture chain with some fields changed
const blockLike = (block, changes) => ({ ...block, ...changes });

// The nodes for the fixture chain, newest first as the
// default export hands them over
const sorted = () => [...f.CHAIN].sort((a, b) => b.height - a.height);
const fixtureNodes = (options = {}) => buildNodes(sorted(), {
  chainTips: f.TIPS,
  transactions: f.TRACKED,
  winningHashes: findWinningBlockHashes(sorted()),
  onBlockClick: () => {},
  ...options,
});
const nodeOf = (nodes, block) => nodes.find((node) => node.id === block.hash);

// Every fixture block's lane, under the fixture's own names
const lanesOf = (chainTips, blocks = f.CHAIN) => {
  const lanes = assignLanes(blocks, chainTips);
  return Object.fromEntries(Object.entries(B).filter(([, block]) => lanes.has(block.hash)).map(([name, block]) => [name, lanes.get(block.hash)]));
};

// The attack the fixture is in the middle of, with the
// private node's next two blocks on top
const P6404 = blockLike(B.p6403, { hash: 'a4'.repeat(32), height: 6404, prevHash: B.p6403.hash });
const P6405 = blockLike(B.p6403, { hash: 'a5'.repeat(32), height: 6405, prevHash: P6404.hash });

// The opening view's settings, as the diagram passes them
const CAMERA = { padding: 0.1, minZoom: 0.6, maxZoom: 1, top: 50 };







// -----------------------------------------------------------
// isAttackerBlock — the colour rule
// -----------------------------------------------------------

describe('isAttackerBlock — only a "Public Miner" coinbase is honest', () => {

  it('a block of the public miner is honest (blue)', () => {
    expect(isAttackerBlock(B.u6401)).toBe(false);
    expect(isAttackerBlock({ coinbase: '/Public Miner/' })).toBe(false);
  });


  it('the mark counts wherever it sits in the coinbase', () => {
    expect(isAttackerBlock({ coinbase: 'Public Miner' })).toBe(false);
    expect(isAttackerBlock({ coinbase: '/Public Miner/ pool #2 \u0003' })).toBe(false);
    expect(isAttackerBlock({ coinbase: 'Binary coinbase: 03e81800 /Public Miner/' })).toBe(false);
  });


  it.each([
    ['a student\'s named attack', f.ATTACKER],
    ['the stack\'s own private stratum', f.STRATUM],
    ['another miner altogether', '/ViaBTC/Mined by knf-student-07/'],
    ['the extractor\'s hex preview', 'Binary coinbase: 03e8180004a1b2c3d4'],
    ['the extractor\'s empty marker', 'Empty coinbase'],
    ['an empty string', ''],
  ])('every other coinbase is the attacker\'s (red): %s', (_, coinbase) => {
    expect(isAttackerBlock({ coinbase })).toBe(true);
  });


  it('only the exact string counts — another spelling or case is the attacker\'s', () => {
    expect(isAttackerBlock({ coinbase: '/public miner/' })).toBe(true);
    expect(isAttackerBlock({ coinbase: '/PUBLIC MINER/' })).toBe(true);
    expect(isAttackerBlock({ coinbase: '/PublicMiner/' })).toBe(true);
    expect(isAttackerBlock({ coinbase: '/Public  Miner/' })).toBe(true);
  });


  it('a block that came without a coinbase counts as the attacker\'s, and does not throw', () => {
    expect(isAttackerBlock({})).toBe(true);
    expect(isAttackerBlock({ coinbase: null })).toBe(true);
    expect(isAttackerBlock(null)).toBe(true);
  });


  it('a coinbase that is not text counts as the attacker\'s, and does not throw', () => {
    expect(isAttackerBlock({ coinbase: 12345 })).toBe(true);
    expect(isAttackerBlock({ coinbase: ['/Public Miner/'] })).toBe(true);
  });


  it('the old private mark "VU KNF" no longer decides anything: with "Public Miner" beside it the block is honest', () => {
    expect(isAttackerBlock({ coinbase: '/VU KNF/' })).toBe(true);
    expect(isAttackerBlock({ coinbase: '/VU KNF/ /Public Miner/' })).toBe(false);
  });
});







// -----------------------------------------------------------
// isDrawable
// -----------------------------------------------------------

describe('isDrawable — a block the diagram can place', () => {

  it('a block with a hash can be placed', () => {
    expect(isDrawable(B.u6401)).toBe(true);
  });


  it.each([
    ['no hash', {}],
    ['a null hash', { hash: null }],
    ['an empty hash', { hash: '' }],
    ['a hash that is no text', { hash: 12345 }],
    ['no block at all', null],
  ])('a block with %s cannot', (_, block) => {
    expect(isDrawable(block)).toBe(false);
  });
});







// -----------------------------------------------------------
// groupByHeight
// -----------------------------------------------------------

describe('groupByHeight', () => {

  it('puts a fork\'s blocks under their shared height, a lone block on its own', () => {
    const byHeight = groupByHeight(f.CHAIN);
    expect(byHeight.get(6402)).toEqual([B.u6402, B.p6402]);
    expect(byHeight.get(6401)).toEqual([B.u6401, B.p6401]);
    expect(byHeight.get(6403)).toEqual([B.p6403]);
    expect(byHeight.get(6400)).toEqual([B.s6400]);
    expect([...byHeight.keys()]).toEqual([6403, 6402, 6401, 6400, 6399, 6398]);
  });


  it('an empty list has no heights', () => {
    expect(groupByHeight([]).size).toBe(0);
  });
});







// -----------------------------------------------------------
// findWinningBlockHashes
// -----------------------------------------------------------

describe('findWinningBlockHashes — the most accumulated work wins', () => {

  // The winners, in the order the blocks came
  const winnersOf = (blocks) => [...findWinningBlockHashes(blocks)];


  it('names the private tip, the block with the most work in the fixture chain — the level blocks below it win nothing', () => {
    expect(winnersOf(f.CHAIN)).toEqual([B.p6403.hash]);
  });


  it('follows the work, not the height: a lower block with more work wins', () => {
    const blocks = [blockLike(B.u6402, { chainWork: 47.6 }), B.p6403];
    expect(winnersOf(blocks)).toEqual([B.u6402.hash]);
  });


  it('compares the work as numbers, also when it arrives as text', () => {
    const blocks = [blockLike(B.u6402, { chainWork: '9.5' }), blockLike(B.p6403, { chainWork: '10.25' })];
    expect(winnersOf(blocks)).toEqual([B.p6403.hash]);
  });


  it('names both tips of two forks of the same length — level on work, whichever order they came in', () => {
    const level = f.CHAIN.filter((block) => block !== B.p6403);
    expect(B.u6402.chainWork).toBe(B.p6402.chainWork);
    expect(new Set(winnersOf(level))).toEqual(new Set([B.u6402.hash, B.p6402.hash]));
    expect(new Set(winnersOf([...level].reverse()))).toEqual(new Set([B.u6402.hash, B.p6402.hash]));
  });


  it('counts work level when it is, also when one side sent it as text', () => {
    expect(new Set(winnersOf([B.u6402, blockLike(B.p6402, { chainWork: String(B.p6402.chainWork) })])).size).toBe(2);
  });


  it('a block without readable work counts as none — and still wins when no block has any', () => {
    expect(winnersOf([blockLike(B.p6403, { chainWork: 'n/a' }), B.u6401])).toEqual([B.u6401.hash]);
    expect(winnersOf([blockLike(B.p6403, { chainWork: undefined })])).toEqual([B.p6403.hash]);
  });


  it('an empty chain has no winner', () => {
    expect(winnersOf([])).toEqual([]);
  });
});








// -----------------------------------------------------------
// assignLanes — every fork on a lane of its own
// -----------------------------------------------------------
//
// Lane 0 is the centre; negative lanes run left, positive
// ones right. The fixture's tips are on separate forks: the
// public node on u6402, the private node on p6403.
// -----------------------------------------------------------

describe('assignLanes — every fork on a vertical lane of its own', () => {

  it('while the nodes are on separate forks: the shared history in the centre, the public node\'s whole fork left, the private node\'s right', () => {
    expect(lanesOf(f.TIPS)).toEqual({ s6398: 0, s6399: 0, s6400: 0, u6401: -1, u6402: -1, p6401: 1, p6402: 1, p6403: 1 });
  });


  it('keeps a fork on its lane however much longer it grows than the other', () => {
    const lanes = assignLanes([P6405, P6404, ...f.CHAIN], { ...f.TIPS, private: P6405.hash });
    expect([P6405, P6404, B.p6403, B.p6401].map((block) => lanes.get(block.hash))).toEqual([1, 1, 1, 1]);
    expect(lanes.get(B.u6402.hash)).toBe(-1);
  });


  it('once both nodes are on the attacker\'s fork, it runs down the centre and the honest fork moves out to the left', () => {
    const tips = { public: B.p6403.hash, private: B.p6403.hash };
    expect(lanesOf(tips)).toEqual({ s6398: 0, s6399: 0, s6400: 0, p6401: 0, p6402: 0, p6403: 0, u6401: -2, u6402: -2 });
  });


  it('once both nodes are on the public fork — the attack lost — that runs down the centre and the attacker\'s fork moves out to the right', () => {
    const tips = { public: B.u6402.hash, private: B.u6402.hash };
    expect(lanesOf(tips)).toEqual({ s6398: 0, s6399: 0, s6400: 0, u6401: 0, u6402: 0, p6401: 2, p6402: 2, p6403: 2 });
  });


  it.each([
    ['the public node', { public: B.u6401.hash, private: B.s6400.hash }, B.u6401, -1],
    ['the private node', { public: B.s6400.hash, private: B.p6401.hash }, B.p6401, 1],
  ])('when %s is a block ahead, that block goes to its side at once, over the shared history in the centre', (_, tips, ahead, lane) => {
    const lanes = assignLanes([B.s6398, B.s6399, B.s6400, ahead], tips);
    expect([B.s6398, B.s6399, B.s6400].map((block) => lanes.get(block.hash))).toEqual([0, 0, 0]);
    expect(lanes.get(ahead.hash)).toBe(lane);
  });


  it('moves nothing when the node behind mines its first block of its own — its lane was kept empty for it', () => {
    const shared = [B.s6398, B.s6399, B.s6400];
    const before = lanesOf({ public: B.s6400.hash, private: B.p6403.hash }, [...shared, B.p6401, B.p6402, B.p6403]);
    const after = lanesOf({ public: B.u6401.hash, private: B.p6403.hash }, [...shared, B.p6401, B.p6402, B.p6403, B.u6401]);
    expect(before).toEqual({ s6398: 0, s6399: 0, s6400: 0, p6401: 1, p6402: 1, p6403: 1 });
    expect(after).toEqual({ ...before, u6401: -1 });
  });


  it.each([
    ['no public tip', { public: null, private: B.p6403.hash }],
    ['a public tip outside the view', { public: 'ab'.repeat(32), private: B.p6403.hash }],
  ])('with %s, the private node\'s chain is the centre and the rest moves out to its side', (_, tips) => {
    expect(lanesOf(tips)).toEqual({ s6398: 0, s6399: 0, s6400: 0, p6401: 0, p6402: 0, p6403: 0, u6401: -2, u6402: -2 });
  });


  it('with no tip in view, the oldest run is the centre and each fork goes to its side — honest left, the attacker\'s right', () => {
    expect(lanesOf({})).toEqual({ s6398: 0, s6399: 0, s6400: 0, u6401: -1, u6402: -1, p6401: 1, p6402: 1, p6403: 1 });
    expect(lanesOf(null)).toEqual(lanesOf({}));
  });


  it('moves a fork out lane by lane until no card on its lane or the next one shares its heights', () => {
    // A dead honest block off the shared history, and a dead
    // attacker block off the private fork
    const stale = blockLike(B.s6400, { hash: 'c1'.repeat(32), prevHash: B.s6399.hash });
    const orphan = blockLike(B.p6402, { hash: 'c2'.repeat(32) });
    const lanes = assignLanes([...f.CHAIN, stale, orphan], f.TIPS);
    expect(lanes.get(stale.hash)).toBe(-2);
    expect(lanes.get(orphan.hash)).toBe(3);
    expect(lanes.get(B.p6402.hash)).toBe(1);
  });


  it('gives two dead forks at the same heights on one side two lanes — the one whose hash sorts first nearer the centre', () => {
    const other = blockLike(B.u6401, { hash: 'cc'.repeat(32) });
    const lanes = assignLanes([...f.CHAIN, other], { public: B.p6403.hash, private: B.p6403.hash });
    expect(lanes.get(B.u6401.hash)).toBe(-2);
    expect(lanes.get(B.u6402.hash)).toBe(-2);
    expect(lanes.get(other.hash)).toBe(-4);
  });


  it('keeps the chain\'s older part in the centre across a gap in the stored blocks', () => {
    const tips = { public: B.p6403.hash, private: B.p6403.hash };
    const lanes = assignLanes([B.p6403, B.p6402, B.p6401, B.s6399, B.s6398], tips);
    expect([B.p6403, B.p6401, B.s6399, B.s6398].map((block) => lanes.get(block.hash))).toEqual([0, 0, 0, 0]);
  });


  it('lays out blocks listed twice once', () => {
    expect(lanesOf(f.TIPS, [...f.CHAIN, ...f.CHAIN.map((block) => ({ ...block }))])).toEqual(lanesOf(f.TIPS));
  });


  it.each([
    ['tips on the loop', { public: 'aa'.repeat(32), private: 'cc'.repeat(32) }],
    ['no tips', {}],
  ])('finishes on parents that loop back — a block its own parent, two blocks each other\'s (%s)', (_, tips) => {
    const blocks = [
      { hash: 'aa'.repeat(32), prevHash: 'bb'.repeat(32), height: 1 },
      { hash: 'bb'.repeat(32), prevHash: 'aa'.repeat(32), height: 2 },
      { hash: 'cc'.repeat(32), prevHash: 'cc'.repeat(32), height: 3 },
    ];
    const lanes = assignLanes(blocks, tips);
    expect(lanes.size).toBe(3);
    expect([...lanes.values()].every(Number.isInteger)).toBe(true);
  });
});







// -----------------------------------------------------------
// buildNodes
// -----------------------------------------------------------

describe('buildNodes — one fixed card per block', () => {

  it('makes one "block" node per block, keyed by its hash, fixed in place but selectable', () => {
    const nodes = fixtureNodes();
    expect(nodes.map((node) => node.id).sort()).toEqual(f.CHAIN.map((block) => block.hash).sort());
    for (const node of nodes) {
      expect(node.type).toBe('block');
      expect(node.draggable).toBe(false);
      expect(node.selectable).toBe(true);
    }
  });


  it('puts the newest height on top and each older one a row (200 px) lower', () => {
    const nodes = fixtureNodes();
    expect(nodeOf(nodes, B.p6403).position.y).toBe(0);
    expect(nodeOf(nodes, B.u6402).position.y).toBe(200);
    expect(nodeOf(nodes, B.p6402).position.y).toBe(200);
    expect(nodeOf(nodes, B.u6401).position.y).toBe(400);
    expect(nodeOf(nodes, B.s6400).position.y).toBe(600);
    expect(nodeOf(nodes, B.s6398).position.y).toBe(1000);
  });


  it('counts rows by rank, not by height: a gap in the heights leaves no empty row', () => {
    const nodes = buildNodes([B.p6403, B.s6398], { chainTips: {}, transactions: [] });
    expect(nodeOf(nodes, B.p6403).position.y).toBe(0);
    expect(nodeOf(nodes, B.s6398).position.y).toBe(200);
  });


  it('stands each block on its lane, 250 px apart: the shared history at x=0, the public fork at -250, the private one at 250 all the way up', () => {
    const nodes = fixtureNodes();
    expect(nodeOf(nodes, B.s6400).position.x).toBe(0);
    expect(nodeOf(nodes, B.s6398).position.x).toBe(0);
    expect(nodeOf(nodes, B.u6401).position.x).toBe(-250);
    expect(nodeOf(nodes, B.u6402).position.x).toBe(-250);
    expect(nodeOf(nodes, B.p6401).position.x).toBe(250);
    expect(nodeOf(nodes, B.p6402).position.x).toBe(250);
    expect(nodeOf(nodes, B.p6403).position.x).toBe(250);
  });


  it('keeps the attacker on the right whichever order the blocks came in', () => {
    const nodes = buildNodes([B.p6402, B.u6402], { chainTips: {}, transactions: [] });
    expect(nodeOf(nodes, B.u6402).position.x).toBe(-250);
    expect(nodeOf(nodes, B.p6402).position.x).toBe(250);
  });


  it('orders blocks of the same side by hash, so a three-way fork keeps its places between refreshes', () => {
    const second = blockLike(B.p6402, { hash: 'ff'.repeat(32) });
    const first = blockLike(B.p6402, { hash: '00'.repeat(32) });
    const forward = buildNodes([B.u6402, second, first], { chainTips: {}, transactions: [] });
    const backward = buildNodes([first, second, B.u6402], { chainTips: {}, transactions: [] });
    for (const nodes of [forward, backward]) {
      expect(nodeOf(nodes, B.u6402).position.x).toBe(-250);
      expect(nodeOf(nodes, first).position.x).toBe(250);
      expect(nodeOf(nodes, second).position.x).toBe(750);
    }
  });


  it('flags the two tips, each on its own block', () => {
    const nodes = fixtureNodes();
    expect(nodes.filter((node) => node.data.isPublicTip).map((node) => node.id)).toEqual([B.u6402.hash]);
    expect(nodes.filter((node) => node.data.isPrivateTip).map((node) => node.id)).toEqual([B.p6403.hash]);
  });


  it('flags one tip block as both when the two nodes agree on it', () => {
    const nodes = fixtureNodes({ chainTips: { public: B.s6400.hash, private: B.s6400.hash } });
    expect(nodeOf(nodes, B.s6400).data).toMatchObject({ isPublicTip: true, isPrivateTip: true });
  });


  it('flags the attacker\'s blocks by the colour rule', () => {
    const nodes = fixtureNodes();
    expect(nodes.filter((node) => node.data.isAttacker).map((node) => node.id).sort()).toEqual([B.p6401.hash, B.p6402.hash, B.p6403.hash].sort());
  });


  it('flags only the winning block, whose work glows', () => {
    const nodes = fixtureNodes();
    expect(nodes.filter((node) => node.data.isWinningChain).map((node) => node.id)).toEqual([B.p6403.hash]);
  });


  it('flags both tips while two forks are level on work', () => {
    const level = sorted().filter((block) => block !== B.p6403);
    const nodes = buildNodes(level, { chainTips: { ...f.TIPS, private: B.p6402.hash }, transactions: [], winningHashes: findWinningBlockHashes(level) });
    expect(nodes.filter((node) => node.data.isWinningChain).map((node) => node.id).sort()).toEqual([B.u6402.hash, B.p6402.hash].sort());
  });


  it('hands each card the tracked transactions found in it — one in two branches shows on both', () => {
    const nodes = fixtureNodes();
    const txids = (block) => nodeOf(nodes, block).data.transactions.map((tx) => tx.txid);
    expect(txids(B.u6401)).toEqual([T.spend]);
    expect(txids(B.p6402)).toEqual([T.double]);
    expect(txids(B.u6402)).toEqual([T.both]);
    expect(txids(B.p6401)).toEqual([T.both]);
    expect(txids(B.s6400)).toEqual([]);
  });


  it('a tracked transaction that came without its block list is in no block', () => {
    const nodes = fixtureNodes({ transactions: [{ txid: T.pending, color: 'orange' }] });
    expect(nodes.every((node) => node.data.transactions.length === 0)).toBe(true);
  });


  it('hands each card its block and the click handler', () => {
    const onBlockClick = vi.fn();
    const nodes = fixtureNodes({ onBlockClick });
    expect(nodeOf(nodes, B.u6401).data.block).toEqual(B.u6401);
    expect(nodeOf(nodes, B.u6401).data.onBlockClick).toBe(onBlockClick);
  });
});







// -----------------------------------------------------------
// buildEdges
// -----------------------------------------------------------

describe('buildEdges — child to parent', () => {

  it('links every block whose parent is in view, from the newer block down to the older one', () => {
    const links = buildEdges(f.CHAIN);
    expect(links).toHaveLength(f.CHAIN.length - 1);
    expect(links.map((edge) => [edge.source, edge.target])).toContainEqual([B.p6401.hash, B.s6400.hash]);
    expect(links.map((edge) => [edge.source, edge.target])).toContainEqual([B.u6401.hash, B.s6400.hash]);
    for (const edge of links) {
      expect(edge.sourceHandle).toBe('bottom');
      expect(edge.targetHandle).toBe('top');
      expect(edge.id).toBe(`${edge.source}-to-${edge.target}`);
    }
  });


  it('draws no edge for the oldest block, whose parent is outside the window — nor for one with no parent', () => {
    const links = buildEdges([...f.CHAIN, blockLike(B.s6398, { hash: 'aa'.repeat(32), prevHash: null })]);
    expect(links.some((edge) => edge.source === B.s6398.hash)).toBe(false);
    expect(links.some((edge) => edge.source === 'aa'.repeat(32))).toBe(false);
  });


  it('colours an edge by the newer block: red out of an attacker block — even onto shared history — blue out of an honest one', () => {
    const colorOf = (child) => buildEdges(f.CHAIN).find((edge) => edge.source === child.hash).style;
    expect(colorOf(B.p6401)).toEqual({ stroke: '#f44336', strokeWidth: 3 });
    expect(colorOf(B.p6403)).toEqual({ stroke: '#f44336', strokeWidth: 3 });
    expect(colorOf(B.u6401)).toEqual({ stroke: '#2196f3', strokeWidth: 3 });
    expect(colorOf(B.s6399)).toEqual({ stroke: '#2196f3', strokeWidth: 3 });
  });


  it('follows the colour rule: a "/VU KNF/" child draws red, a "Public Miner" one blue', () => {
    const stratum = blockLike(B.p6401, { coinbase: f.STRATUM });
    const honest = blockLike(B.p6401, { coinbase: 'pool /Public Miner/' });
    expect(buildEdges([stratum, B.s6400])[0].style.stroke).toBe('#f44336');
    expect(buildEdges([honest, B.s6400])[0].style.stroke).toBe('#2196f3');
  });


  it('draws every edge as a plain solid line — no running dashes, not even out of the two tips', () => {
    const links = buildEdges(f.CHAIN);
    expect(links.filter((edge) => edge.animated)).toEqual([]);
    expect(links.filter((edge) => edge.source === B.p6403.hash || edge.source === B.u6402.hash)).toHaveLength(2);
  });
});








// -----------------------------------------------------------
// axisCamera — the opening view
// -----------------------------------------------------------
//
// ReactFlow positions a card by its left edge; the centre
// lane's cards stand at x=0, so its axis runs half a card in.
// -----------------------------------------------------------

describe('axisCamera — the opening view, the centre lane down the middle', () => {

  // The fixture's cards at their places, measured as ReactFlow
  // measures them
  const measured = (width = 450) => fixtureNodes().map((node) => ({ ...node, width }));


  it('puts the centre lane\'s axis in the middle of the frame and the newest row the top margin down', () => {
    expect(axisCamera(measured(), 1600, CAMERA)).toEqual({ x: 800 - 225, y: 50, zoom: 1 });
  });


  it('keeps the axis in the middle when the forks all sit on one side, zooming out to fit the side that reaches further', () => {
    const lopsided = [
      { position: { x: 0, y: 0 }, width: 450 },
      { position: { x: -500, y: 200 }, width: 450 },
    ];
    const { x, zoom } = axisCamera(lopsided, 1000, CAMERA);
    expect(x + 225 * zoom).toBeCloseTo(500);
    expect(zoom).toBeCloseTo(1000 / (2 * 725 * 1.1));
    // the far card's left edge inside the frame
    expect(x - 500 * zoom).toBeGreaterThan(0);
  });


  it('zooms out no further than the minimum and in no further than the maximum', () => {
    expect(axisCamera(measured(), 300, CAMERA).zoom).toBe(0.6);
    expect(axisCamera(measured(), 5000, CAMERA).zoom).toBe(1);
  });


  it('runs the axis down the middle of the cards as measured, and of the 450 px they are before that', () => {
    expect(axisCamera(measured(478), 1600, CAMERA).x).toBe(800 - 239);
    expect(axisCamera(measured(null), 1600, CAMERA).x).toBe(800 - 225);
  });


  it.each([
    ['a frame without a width yet', measured(), 0],
    ['a frame not there at all', measured(), undefined],
    ['no cards', [], 1600],
  ])('has no view for %s', (_, nodes, frameWidth) => {
    expect(axisCamera(nodes, frameWidth, CAMERA)).toBeNull();
  });
});







// -----------------------------------------------------------
// buildBlockchainFlow (default export)
// -----------------------------------------------------------

describe('buildBlockchainFlow', () => {

  it('an empty chain is an empty diagram', () => {
    expect(buildBlockchainFlow([], { chainTips: f.TIPS, transactions: f.TRACKED })).toEqual({ nodes: [], edges: [] });
  });


  it('lays the chain out the same whichever order the backend listed it in', () => {
    const options = { chainTips: f.TIPS, transactions: f.TRACKED };
    const newestFirst = buildBlockchainFlow(f.CHAIN, options);
    const oldestFirst = buildBlockchainFlow([...f.CHAIN].reverse(), options);
    const places = ({ nodes }) => Object.fromEntries(nodes.map((node) => [node.id, node.position]));
    expect(places(oldestFirst)).toEqual(places(newestFirst));
  });


  it('leaves out a block it cannot place, and draws the rest', () => {
    const { nodes, edges } = buildBlockchainFlow([...f.CHAIN, { ...B.s6398, hash: null, height: 1 }, { height: 2 }],
      { chainTips: f.TIPS, transactions: f.TRACKED });
    expect(nodes).toHaveLength(8);
    expect(edges).toHaveLength(7);
  });


  it('a chain of blocks it can place none of is an empty diagram', () => {
    expect(buildBlockchainFlow([{ hash: null }, { hash: 12345 }], { chainTips: f.TIPS, transactions: [] })).toEqual({ nodes: [], edges: [] });
  });


  it('copes with missing tips and with transactions whose block list is no list', () => {
    const { nodes } = buildBlockchainFlow(f.CHAIN, { chainTips: null, transactions: [{ txid: 'a1', blocks: B.u6401.hash }, null] });
    expect(nodes.some((node) => node.data.isPublicTip || node.data.isPrivateTip)).toBe(false);
    expect(nodes.every((node) => node.data.transactions.length === 0)).toBe(true);
  });


  it('leaves the caller\'s list in its order — it belongs to the query cache', () => {
    const chain = [B.s6398, B.p6403, B.s6400];
    buildBlockchainFlow(chain, { chainTips: f.TIPS, transactions: [] });
    expect(chain).toEqual([B.s6398, B.p6403, B.s6400]);
  });


  it('builds nodes and edges together, the winner decided over the whole chain', () => {
    const { nodes, edges } = buildBlockchainFlow(f.CHAIN, { chainTips: f.TIPS, transactions: f.TRACKED });
    expect(nodes).toHaveLength(8);
    expect(edges).toHaveLength(7);
    expect(nodeOf(nodes, B.p6403).data.isWinningChain).toBe(true);
  });
});
