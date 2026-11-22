import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { sfx } from './feel/sound';

// Every button press clicks (one listener instead of a call in each handler).
document.addEventListener('click', (e) => {
  if (e.target instanceof Element && e.target.closest('button')) sfx.click();
});

// Canvas-drawn labels need the display font loaded first; don't wait more than 1.5 s for it.
const fontReady = Promise.race([
  document.fonts.load('64px "Lilita One"'),
  new Promise((resolve) => setTimeout(resolve, 1500)),
]).catch(() => undefined);

void fontReady.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
