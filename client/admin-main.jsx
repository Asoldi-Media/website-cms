/** Vite entry. Mounts ClientCMS for the prebuilt /admin SPA. */
import { createRoot } from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { ClientCMS } from './ClientCMS.jsx';
import './admin.css';
const root = document.getElementById('root');
if (!root)
    throw new Error('Admin root #root is missing');
createRoot(root).render(<HelmetProvider>
    <ClientCMS />
  </HelmetProvider>);
