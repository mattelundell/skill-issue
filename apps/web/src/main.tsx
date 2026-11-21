import '@fontsource/atkinson-hyperlegible-next/400.css';
import '@fontsource/atkinson-hyperlegible-next/600.css';
import '@fontsource/atkinson-hyperlegible-next/700.css';
import '@fontsource/newsreader/500.css';
import '@fontsource/newsreader/600.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { webModules } from './modules/index.js';
import './styles.css';

const root = document.getElementById('root');
if (root === null) {
  throw new Error('index.html has no #root element to mount the application in');
}

createRoot(root).render(
  <StrictMode>
    <App modules={webModules} />
  </StrictMode>,
);
