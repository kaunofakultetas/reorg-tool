// -----------------------------------------------------------
//  [*] Tests — 51% attack: the block details (BlockDetailsModal)
//
//  The dialog a click on a block opens, rendered on its own
//  and fed the way the diagram feeds it (the clicked node's
//  data):
//    - nothing at all without a block, nothing while closed
//    - the title and the verdict chip — "Atakuotojo blokas"
//      for the attacker's, "Sąžiningas blokas" for an honest
//      one
//    - every field, whole: height, the accumulated work at
//      full precision, both SHA-256 hashes (the previous one
//      left out for the genesis or an unknown parent), the
//      SCRYPT proof-of-work hash, the coinbase uncut, the time
//      on the student's clock with its timezone and offset
//      named (winter or summer), and the header's raw Unix
//      timestamp — dashes for a block without a usable one
//    - the tracked transactions in the block, each a chip
//      with its whole txid in its colour
//    - closing: the ✕, the "Uždaryti" button, Escape, a click
//      beside the dialog
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderPage } from '../../support/render';
import { NAMED } from '../../support/reorg-attack/page';
import * as f from '../../support/backend/fixtures';
import BlockDetailsModal from '@/pages/ReorgAttack/components/BlockDetailsModal';
import { isAttackerBlock } from '@/pages/ReorgAttack/components/blockchainFlow';


const { B } = f;

// The node data the diagram hands over for a block, and the
// dialog opened on it
const dataOf = (block, transactions = []) => ({ block, transactions, isAttacker: isAttackerBlock(block) });

function renderDetails(block, { transactions = [], open = true, onClose = vi.fn() } = {}) {
  const blockData = block ? dataOf(block, transactions) : null;
  const view = renderPage(
    <BlockDetailsModal open={open} onClose={onClose} blockData={blockData} transactions={transactions} isAttacker={blockData?.isAttacker ?? false} />
  );
  return { ...view, onClose };
}

// A field's value: the text under its caption
const field = (label) => within(screen.getByRole('dialog')).getByText(label).nextSibling.textContent;

const tracked = (txid) => f.TRACKED.find((tx) => tx.txid === txid);







// -----------------------------------------------------------
// Opening
// -----------------------------------------------------------

describe('Block details — when it shows', () => {

  it('shows nothing without a block, even asked to open', () => {
    renderDetails(null);
    expect(screen.queryByRole('dialog')).toBeNull();
  });


  it('shows nothing while closed', () => {
    renderDetails(B.u6401, { open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });


  it('opens titled "Bloko Informacija"', () => {
    renderDetails(B.u6401);
    expect(within(screen.getByRole('dialog')).getByText('Bloko Informacija')).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// The verdict
// -----------------------------------------------------------

describe('Block details — honest or the attacker\'s', () => {

  it('calls a "Public Miner" block honest', () => {
    renderDetails(B.u6401);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Sąžiningas blokas')).toBeInTheDocument();
    expect(within(dialog).queryByText('Atakuotojo blokas')).toBeNull();
  });


  it.each([
    ['a student\'s named attack', B.p6403],
    ['the stack\'s own stratum', { ...B.s6400, coinbase: f.STRATUM }],
  ])('calls every other block the attacker\'s: %s', (_, block) => {
    renderDetails(block);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Atakuotojo blokas')).toBeInTheDocument();
    expect(within(dialog).queryByText('Sąžiningas blokas')).toBeNull();
  });
});







// -----------------------------------------------------------
// The fields
// -----------------------------------------------------------

describe('Block details — the fields', () => {

  it('shows the height, the work at full precision, both hashes, the proof-of-work hash, the coinbase and the time', () => {
    renderDetails(B.p6403);
    expect(field('Bloko Aukštis')).toBe('6403');
    expect(field('Grandinės Sukauptinis Visas Darbas (Log2)')).toBe('47.5432797122037');
    expect(field('Bloko SHA256 Hash (Šio)')).toBe(B.p6403.hash);
    expect(field('Bloko SHA256 Hash (Ankstesnio)')).toBe(B.p6402.hash);
    expect(field('Bloko SCRYPT Hash (Šio)')).toBe(B.p6403.scryptHash);
    expect(field('Laikas')).toBe('2026-10-19 05:19:02 (Europe/Vilnius, UTC+3)');
    expect(field('Laikas (Unix)')).toBe('1792376342');
  });


  it('names the winter offset for a block mined in winter', () => {
    renderDetails({ ...B.p6403, timestamp: Date.parse('2026-01-15T12:00:00Z') / 1000 });
    expect(field('Laikas')).toBe('2026-01-15 14:00:00 (Europe/Vilnius, UTC+2)');
    expect(field('Laikas (Unix)')).toBe('1768478400');
  });


  it.each([
    ['no time at all', undefined],
    ['a null', null],
    ['the time as text', '1792376342'],
    ['a number no date can hold', 1e20],
  ])('shows dashes for the time of a block that came with %s', (_, timestamp) => {
    renderDetails({ ...B.p6403, timestamp });
    expect(field('Laikas')).toBe('—');
    expect(field('Laikas (Unix)')).toBe('—');
  });


  it('shows the coinbase whole — the card cuts it, the details do not', () => {
    renderDetails(B.p6403);
    expect(field('Coinbase Žinutė')).toBe('/Vardenis Pavardenis ATAKA (2026-10-15)/');
  });


  it('shows an empty coinbase for a block that came without one — and calls it the attacker\'s', () => {
    renderDetails({ ...B.u6401, coinbase: null });
    expect(field('Coinbase Žinutė')).toBe('');
    expect(within(screen.getByRole('dialog')).getByText('Atakuotojo blokas')).toBeInTheDocument();
  });


  it('shows the work as a number even when it arrives as text', () => {
    renderDetails({ ...B.u6401, chainWork: '47.5423603105327' });
    expect(field('Grandinės Sukauptinis Visas Darbas (Log2)')).toBe('47.5423603105327');
  });


  it.each([
    ['the genesis block', 'genesis'],
    ['an unknown parent', ''],
    ['no parent at all', null],
  ])('leaves the previous hash out for %s', (_, prevHash) => {
    renderDetails({ ...B.s6398, prevHash });
    expect(within(screen.getByRole('dialog')).queryByText('Bloko SHA256 Hash (Ankstesnio)')).toBeNull();
    expect(field('Bloko SHA256 Hash (Šio)')).toBe(B.s6398.hash);
  });
});







// -----------------------------------------------------------
// The tracked transactions
// -----------------------------------------------------------

describe('Block details — the tracked transactions in it', () => {

  it('lists each one as a chip with its whole txid, in its colour', () => {
    renderDetails(B.u6401, { transactions: [tracked(f.T.spend)] });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Sekamos Transakcijos')).toBeInTheDocument();
    const chip = within(dialog).getByText(f.T.spend).parentElement;
    expect(getComputedStyle(chip).backgroundColor).toBe(NAMED.red);
  });


  it('lists every one when there are several', () => {
    renderDetails(B.u6402, { transactions: [tracked(f.T.both), tracked(f.T.double)] });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(f.T.both)).toBeInTheDocument();
    expect(within(dialog).getByText(f.T.double)).toBeInTheDocument();
  });


  it('leaves the section out for a block with none', () => {
    renderDetails(B.s6400);
    expect(within(screen.getByRole('dialog')).queryByText('Sekamos Transakcijos')).toBeNull();
  });
});







// -----------------------------------------------------------
// Closing
// -----------------------------------------------------------

describe('Block details — closing', () => {

  it('the ✕ in the title closes it', async () => {
    const { user, onClose } = renderDetails(B.u6401);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'uždaryti' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });


  it('the "Uždaryti" button closes it', async () => {
    const { user, onClose } = renderDetails(B.u6401);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Uždaryti' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });


  it('Escape closes it', async () => {
    const { user, onClose } = renderDetails(B.u6401);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });


  it('a click beside the dialog closes it', async () => {
    const { user, onClose } = renderDetails(B.u6401);
    const backdrop = document.querySelector('.MuiBackdrop-root');
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
