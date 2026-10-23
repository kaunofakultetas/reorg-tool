// -----------------------------------------------------------
//  [*] ReorgAttack — BlockDetailsModal
//
//  Everything about one block, opened by clicking it in the
//  fork diagram: height, accumulated work, both SHA-256
//  hashes, the SCRYPT proof-of-work hash, the coinbase
//  message (which is what marks a block as the attacker's),
//  the time it was mined and the tracked transactions it
//  carries.
//
//  The time is the student's local one, named with the
//  browser's timezone and its offset from UTC, and then as
//  the header carries it: the raw Unix timestamp — the one
//  number every node and every timezone agrees on.
//
//  Split into (root component last):
//
//    DetailRow          — one caption + monospace value
//    BlockDetailsModal  — the dialog (default export)
// -----------------------------------------------------------

import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, IconButton, Box, Typography, Chip, Divider,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

import { localBlockTime } from '../lib/blockTime';







// -----------------------------------------------------------
// DetailRow
// -----------------------------------------------------------
//
// One labelled field — hashes wrap rather than overflow.
//
// Used by:
//   - BlockDetailsModal (below)
// -----------------------------------------------------------

function DetailRow({ label, children }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
        {children}
      </Typography>
    </Box>
  );
}







// -----------------------------------------------------------
// BlockDetailsModal (default export)
// -----------------------------------------------------------
//
// Used by:
//   - ReactFlowBlockchain.jsx — opened on a block click
// -----------------------------------------------------------

export default function BlockDetailsModal({ open, onClose, blockData, transactions = [], isAttacker }) {

  if (!blockData) return null;

  const { block } = blockData;

  // A dash for both time rows when the payload carried no
  // usable timestamp
  const time = localBlockTime(block.timestamp);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      BackdropProps={{
        sx: {
          backgroundColor: 'transparent',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        },
      }}
    >
      <DialogTitle sx={{ pr: 6, bgcolor: isAttacker ? 'rgba(244, 67, 54, 0.1)' : 'rgba(33, 150, 243, 0.1)' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
            Bloko Informacija
          </Typography>

          {isAttacker ? (
            <Chip label="Atakuotojo blokas" color="error" size="small" />
          ) : (
            <Chip label="Sąžiningas blokas" size="small" sx={{ backgroundColor: 'lightblue' }} />
          )}
        </Box>

        <IconButton aria-label="uždaryti" onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ display: 'grid', gap: 1, mb: 3 }}>
          <DetailRow label="Bloko Aukštis">{block.height}</DetailRow>

          <DetailRow label="Grandinės Sukauptinis Visas Darbas (Log2)">
            {Number(block.chainWork)}
          </DetailRow>

          <DetailRow label="Bloko SHA256 Hash (Šio)">{block.hash}</DetailRow>

          {block.prevHash && block.prevHash !== 'genesis' && (
            <DetailRow label="Bloko SHA256 Hash (Ankstesnio)">{block.prevHash}</DetailRow>
          )}

          <DetailRow label="Bloko SCRYPT Hash (Šio)">{block.scryptHash}</DetailRow>

          <DetailRow label="Coinbase Žinutė">{String(block.coinbase ?? '')}</DetailRow>

          <DetailRow label="Laikas">{time ? `${time.local} (${time.zone}, ${time.offset})` : '—'}</DetailRow>

          <DetailRow label="Laikas (Unix)">{time ? block.timestamp : '—'}</DetailRow>
        </Box>

        {transactions.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />

            <Typography variant="h6" sx={{ mb: 2, color: 'black' }}>
              Sekamos Transakcijos
            </Typography>

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {transactions.map((tx) => (
                <Chip
                  key={tx.txid}
                  label={tx.txid}
                  size="small"
                  sx={{ bgcolor: tx.color, color: 'white', '&:hover': { opacity: 0.8 } }}
                />
              ))}
            </Box>
          </>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="contained">
          Uždaryti
        </Button>
      </DialogActions>
    </Dialog>
  );
}
