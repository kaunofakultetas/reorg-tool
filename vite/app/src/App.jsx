// -----------------------------------------------------------
//  [*] App — providers, page shell and routing
//
//  The root of the React app: the MUI style/theme stack, the
//  Navbar/Footer shell and the routes. There is a single tool
//  in this stack — the 51% attack teaching page — so routing
//  is deliberately thin:
//    - "/"            → redirect into /reorgattack
//    - /reorgattack   → the attack tool
//
//  The whole app lives behind ONE burgundy bar and a copyright
//  footer; the routed page fills the grey space between them.
// -----------------------------------------------------------

import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';

import { ThemeProvider, CssBaseline, Box } from '@mui/material';
import { StyledEngineProvider } from '@mui/material/styles';
import theme from '@/theme';

import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

// Pages
import ReorgAttackPage from '@/pages/ReorgAttack/Page';







// -----------------------------------------------------------
// App (default export)
// -----------------------------------------------------------
//
// The provider stack (style engine → theme → router) around
// the fixed shell: Navbar on top, the routed page in the grey
// middle, Footer at the bottom.
//
// Used by:
//   - main.jsx — mounted into #root
// -----------------------------------------------------------

export default function App() {
  return (
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Router>
          <Navbar />

          <Box className="bg-gray-100" style={{ minHeight: 'calc(100vh - 105px)' }}>
            <Routes>

              {/* "/" → the only tool in this stack */}
              <Route index element={<Navigate to="/reorgattack" replace />} />

              {/* The 51% attack teaching tool */}
              <Route path="reorgattack" element={<ReorgAttackPage />} />

            </Routes>
          </Box>

          <Footer />
        </Router>
      </ThemeProvider>
    </StyledEngineProvider>
  );
}
