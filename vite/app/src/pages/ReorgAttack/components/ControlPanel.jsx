// -----------------------------------------------------------
//  [*] ReorgAttack — ControlPanel
//
//  The sliding side panel that drives the attack: the switch
//  attaching or detaching the private node from the public
//  network, a raw HEX transaction sender, and the colour-coded
//  transaction tracker.
//
//  The panel OWNS its form state (the two text fields and
//  their colours) — the page only receives finished actions
//  (onSendRawTransaction({ raw, color })), so typing here
//  never re-renders the fork diagram.
//
//  The switch only ever shows what the backend reported:
//  until the private node's status has been read — or when it
//  could not be — the panel says the state is unknown and the
//  switch waits, instead of guessing "detached". Slid out of
//  view, the panel is hidden from the keyboard and from screen
//  readers too, not only from the eye.
//
//  Split into (root component last):
//
//    TRANSACTION_COLORS — the tracking palette
//    CONTROL_PANEL_ID   — the panel's id, for the gear button
//    CONNECTION_STATES  — what the switch says in each state
//    ColorSelect        — colour dropdown with colour dots
//    ConnectionSection  — the public-network switch + status
//    RawTransactionForm — the HEX sender
//    TrackedTransaction — one row of the tracked list
//    TrackingSection    — add form + tracked list
//    ControlPanel       — the panel shell (default export)
// -----------------------------------------------------------

import { useState } from 'react';

import {
  Box, Typography, Paper, Button, TextField, FormControl, InputLabel,
  Select, MenuItem, IconButton, Divider, Alert, Switch, FormControlLabel,
} from '@mui/material';

import { MdAdd, MdSend, MdWifi, MdWifiOff, MdClose, MdHelpOutline } from 'react-icons/md';
import DeleteIcon from '@mui/icons-material/Delete';


// The palette a student picks from when colour-tracking a
// transaction across the two chains
const TRANSACTION_COLORS = ['red', 'green', 'blue', 'orange', 'purple', 'pink', 'cyan', 'yellow'];

// The panel's element id — the gear button (ToggleButton.jsx)
// names it as the panel it opens and closes
export const CONTROL_PANEL_ID = 'reorg-control-panel';

// The switch's label, its icon and the note under it, for each
// state of the private node — the two the backend reports, and
// the two in which it has not (yet) told: still asking, or the
// status could not be read
const CONNECTION_STATES = {
  attached: { label: 'Prisijungę prie viešo tinklo', Icon: MdWifi, severity: 'success', note: 'Mazgas operuoja viešai' },
  detached: { label: 'Atjungę nuo viešo tinklo', Icon: MdWifiOff, severity: 'warning', note: 'Mazgas operuoja privačiai' },
  checking: { label: 'Mazgo būsena nežinoma', Icon: MdHelpOutline, severity: 'info', note: 'Tikrinama mazgo būsena…' },
  failed: { label: 'Mazgo būsena nežinoma', Icon: MdHelpOutline, severity: 'error', note: 'Nepavyko gauti mazgo būsenos' },
};







// -----------------------------------------------------------
// ColorSelect
// -----------------------------------------------------------
//
// The tracking-colour dropdown: every option shows the colour
// as a dot next to its name.
//
// Used by:
//   - RawTransactionForm, TrackingSection (below)
// -----------------------------------------------------------

function ColorSelect({ value, onChange }) {
  return (
    <FormControl size="small" sx={{ flex: 1 }}>
      <InputLabel>Spalva</InputLabel>
      <Select value={value} label="Spalva" onChange={(event) => onChange(event.target.value)}>
        {TRANSACTION_COLORS.map((color) => (
          <MenuItem key={color} value={color}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box
                sx={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  backgroundColor: color,
                  border: '1px solid rgba(0,0,0,0.2)',
                }}
              />
              {color.charAt(0).toUpperCase() + color.slice(1)}
            </Box>
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}







// -----------------------------------------------------------
// ConnectionSection
// -----------------------------------------------------------
//
// The attack switch: detaching the private node lets it mine
// its own fork in secret. The switch reflects the BACKEND's
// reported state, so a failed toggle simply stays where it
// was — there is nothing to revert by hand. While that state
// is unknown (statusKnown false) the switch is off and
// disabled and says so, with the reason when the status read
// failed.
//
// Used by:
//   - ControlPanel (below)
// -----------------------------------------------------------

function ConnectionSection({ isConnectedToPublic, statusKnown, statusError, onConnectionToggle, busy, networkStatus }) {

  const state = !statusKnown
    ? (statusError ? 'failed' : 'checking')
    : (isConnectedToPublic ? 'attached' : 'detached');
  const { label, Icon, severity, note } = CONNECTION_STATES[state];


  return (
    <Box sx={{ mb: 3 }}>
      <FormControlLabel
        control={
          <Switch
            checked={statusKnown && isConnectedToPublic}
            onChange={(event) => onConnectionToggle(event.target.checked)}
            disabled={busy || !statusKnown}
            color="primary"
          />
        }
        label={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Icon />
            {label}
          </Box>
        }
      />

      <Alert severity={severity} sx={{ mt: 1, fontSize: '0.8rem' }}>
        {state === 'failed' ? `${note}: ${statusError.message}` : note}
      </Alert>

      <Box sx={{ mt: 2 }}>
        <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 1 }}>
          Tinklų Būsena:
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {networkStatus.connection && (
            <Typography variant="caption" color="text.secondary">
              Peers: {networkStatus.connection.peers?.length || 0}
            </Typography>
          )}

          {networkStatus.publicTip && (
            <Typography variant="caption" color="text.secondary">
              Viešo tinklo viršūnės aukštis: {networkStatus.publicTip.height ?? 'N/A'}
              {networkStatus.publicTip.available ? ' ✅' : ' ❌'}
            </Typography>
          )}

          {networkStatus.privateTip && (
            <Typography variant="caption" color="text.secondary">
              Privataus mazgo viršūnės aukštis: {networkStatus.privateTip.height ?? 'N/A'}
              {networkStatus.privateTip.available ? ' ✅' : ' ❌'}
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}







// -----------------------------------------------------------
// RawTransactionForm
// -----------------------------------------------------------
//
// Broadcasts a raw HEX transaction straight into the private
// node — the field clears itself once the send is away.
//
// Used by:
//   - ControlPanel (below)
// -----------------------------------------------------------

function RawTransactionForm({ onSend, busy }) {

  const [raw, setRaw] = useState('');
  const [color, setColor] = useState('red');


  const send = () => {
    onSend({ raw: raw.trim(), color });
    setRaw('');
  };


  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
        Siųsti Transakciją į Privatų Mazgą
      </Typography>

      <TextField
        fullWidth
        multiline
        rows={3}
        placeholder="Įveskite transakciją HEX formatu..."
        value={raw}
        onChange={(event) => setRaw(event.target.value)}
        variant="outlined"
        size="small"
        sx={{ mb: 1 }}
      />

      <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
        <ColorSelect value={color} onChange={setColor} />
      </Box>

      <Button
        fullWidth
        variant="contained"
        onClick={send}
        disabled={!raw.trim() || busy}
        startIcon={<MdSend />}
        sx={{ backgroundColor: '#1976d2' }}
      >
        Siųsti Transakciją
      </Button>
    </Box>
  );
}







// -----------------------------------------------------------
// TrackedTransaction
// -----------------------------------------------------------
//
// One tracked transaction: its colour dot, shortened txid and
// how many blocks it was found in — the number that exposes a
// double-spend when the chains disagree.
//
// Used by:
//   - TrackingSection (below)
// -----------------------------------------------------------

function TrackedTransaction({ transaction, onRemove, busy }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              backgroundColor: transaction.color,
              border: '1px solid rgba(0,0,0,0.2)',
            }}
          />
          <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
            {transaction.txid.substring(0, 12)}...
          </Typography>
        </Box>

        <IconButton
          size="small"
          onClick={() => onRemove(transaction.txid)}
          disabled={busy}
          aria-label={`Nebesekti transakcijos ${transaction.txid.substring(0, 12)}...`}
          sx={{ p: 0.5 }}
        >
          <DeleteIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
        {transaction.blocks?.length > 0
          ? `Rasta ${transaction.blocks.length} blokuose`
          : 'Nerasta nei viename bloke'}
      </Typography>
    </Box>
  );
}







// -----------------------------------------------------------
// TrackingSection
// -----------------------------------------------------------
//
// Add a txid to the colour-tracked list, and the list itself.
//
// Used by:
//   - ControlPanel (below)
// -----------------------------------------------------------

function TrackingSection({ transactions, onAdd, onRemove, busy }) {

  const [txid, setTxid] = useState('');
  const [color, setColor] = useState('green');


  const add = () => {
    onAdd({ txid: txid.trim(), color });
    setTxid('');
  };


  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 'bold' }}>
        Transakcijų Sekimas
      </Typography>

      <Box sx={{ mb: 2 }}>
        <TextField
          fullWidth
          placeholder="Įveskite transakcijos ID..."
          value={txid}
          onChange={(event) => setTxid(event.target.value)}
          variant="outlined"
          size="small"
          sx={{ mb: 1 }}
        />

        <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
          <ColorSelect value={color} onChange={setColor} />

          <Button
            variant="contained"
            onClick={add}
            disabled={!txid.trim() || busy}
            startIcon={<MdAdd />}
            size="small"
          >
            Pridėti
          </Button>
        </Box>
      </Box>

      <Typography variant="body2" sx={{ mb: 1, color: 'text.secondary' }}>
        Sekamos Transakcijos ({transactions.length})
      </Typography>

      {transactions.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
          Nesekama nei viena transakcija
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {transactions.map((transaction) => (
            <TrackedTransaction
              key={transaction.txid}
              transaction={transaction}
              onRemove={onRemove}
              busy={busy}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}







// -----------------------------------------------------------
// ControlPanel (default export)
// -----------------------------------------------------------
//
// The panel slides in from the right edge. Slid out, it turns
// invisible once the slide has finished — visibility changes
// at the END of its transition — which takes every control in
// it out of the keyboard's tab order and the screen reader's
// view; sliding in, it shows at once. Its id is what the gear
// button names as the panel it controls.
//
// Used by:
//   - Page.jsx — the sliding panel on the right
// -----------------------------------------------------------

export default function ControlPanel({
  isPanelOpen, onClose, panelWidth, isConnectedToPublic, statusKnown = true, statusError = null,
  onConnectionToggle, onSendRawTransaction, transactions, onAddTransaction, onRemoveTransaction,
  networkStatus, busy,
}) {
  return (
    <Paper
      id={CONTROL_PANEL_ID}
      elevation={3}
      sx={{
        position: 'fixed',
        top: 0,
        right: isPanelOpen ? 0 : '-100%',
        visibility: isPanelOpen ? 'visible' : 'hidden',
        width: panelWidth,
        height: '100vh',
        p: 2,
        zIndex: 1000,
        overflow: 'auto',
        transition: 'right 0.3s ease-in-out, visibility 0.3s',
        backgroundColor: 'white',
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
          Valdymo Skydas
        </Typography>
        <IconButton onClick={onClose} aria-label="Uždaryti valdymo skydą" size="small" sx={{ color: 'text.secondary' }}>
          <MdClose />
        </IconButton>
      </Box>

      <ConnectionSection
        isConnectedToPublic={isConnectedToPublic}
        statusKnown={statusKnown}
        statusError={statusError}
        onConnectionToggle={onConnectionToggle}
        busy={busy}
        networkStatus={networkStatus}
      />

      <Divider sx={{ mb: 2 }} />

      <RawTransactionForm onSend={onSendRawTransaction} busy={busy} />

      <Divider sx={{ mb: 3 }} />

      <TrackingSection
        transactions={transactions}
        onAdd={onAddTransaction}
        onRemove={onRemoveTransaction}
        busy={busy}
      />
    </Paper>
  );
}
