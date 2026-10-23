// -----------------------------------------------------------
//  [*] ReorgAttack — ToggleButton
//
//  The floating gear button in the bottom-right corner that
//  opens and closes the control panel. Sits above the panel's
//  own z-index, so it stays reachable while the panel is out,
//  and tells a screen reader whether the panel it controls is
//  open.
// -----------------------------------------------------------

import { IconButton } from '@mui/material';
import { MdSettings } from 'react-icons/md';

import { CONTROL_PANEL_ID } from './ControlPanel';







// -----------------------------------------------------------
// ToggleButton (default export)
// -----------------------------------------------------------
//
// The gear itself: one click flips the panel, aria-expanded
// follows isPanelOpen.
//
// Used by:
//   - Page.jsx — opens/closes ControlPanel
// -----------------------------------------------------------

export default function ToggleButton({ isPanelOpen, onToggle }) {
  return (
    <IconButton
      onClick={onToggle}
      aria-label="Valdymo skydas"
      aria-expanded={isPanelOpen}
      aria-controls={CONTROL_PANEL_ID}
      sx={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        backgroundColor: 'primary.main',
        color: 'white',
        zIndex: 1001,
        width: 56,
        height: 56,
        '&:hover': {
          backgroundColor: 'primary.dark',
        },
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      }}
    >
      <MdSettings size={28} />
    </IconButton>
  );
}
