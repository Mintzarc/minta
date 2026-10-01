import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WalletProvider } from './lib/wallet';
import App from './App';
import Splash from './components/Splash';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WalletProvider>
      <App />
      <Splash />
    </WalletProvider>
  </StrictMode>,
);
