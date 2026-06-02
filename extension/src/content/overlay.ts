/**
 * Autofill suggestion overlay rendered inside a Shadow DOM so the page's
 * CSS and JavaScript cannot interact with or read the overlay content.
 *
 * The overlay is anchored below the password field and shows a list of
 * matching vault entries. Clicking one triggers the `onSelect` callback
 * with the entry — the background service worker handles the decryption.
 */

import type { AutofillCandidate } from '../shared/messages.js';

export type { AutofillCandidate };

const OVERLAY_CSS = `
  :host { all: initial; position: absolute; z-index: 2147483647; }
  .kx-overlay {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    color: #e2e2f0;
    background: #16162a;
    border: 1px solid #2e2e50;
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    overflow: hidden;
    min-width: 240px;
    max-width: 340px;
  }
  .kx-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    border-bottom: 1px solid #2e2e50;
    font-size: 10px;
    font-weight: 600;
    color: #7c6df0;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .kx-entry {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    cursor: pointer;
    transition: background 0.08s;
    outline: none;
  }
  .kx-entry:hover, .kx-entry:focus { background: #22224a; }
  .kx-icon {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: #2e2e50;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    flex-shrink: 0;
  }
  .kx-info  { flex: 1; min-width: 0; }
  .kx-name  { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .kx-user  { font-size: 11px; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
  .kx-footer {
    padding: 5px 12px;
    border-top: 1px solid #2e2e50;
    font-size: 10px;
    color: #555;
    text-align: center;
  }
`;

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

/**
 * Create and mount the autofill overlay anchored to `anchor`.
 * Returns a cleanup function that removes the overlay and all listeners.
 */
export function mountOverlay(
  anchor: HTMLInputElement,
  candidates: AutofillCandidate[],
  onSelect: (c: AutofillCandidate) => void,
): () => void {
  const host = document.createElement('kx-autofill');
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;

  const root = document.createElement('div');
  root.className = 'kx-overlay';
  root.setAttribute('role', 'listbox');
  root.setAttribute('aria-label', 'Kairox saved logins');

  const header = document.createElement('div');
  header.className = 'kx-header';
  header.textContent = 'Kairox · Saved logins';
  root.appendChild(header);

  for (const candidate of candidates) {
    const row = document.createElement('div');
    row.className = 'kx-entry';
    row.setAttribute('role', 'option');
    row.setAttribute('tabindex', '0');
    row.innerHTML = `
      <div class="kx-icon">${escHtml(getInitial(candidate.name))}</div>
      <div class="kx-info">
        <div class="kx-name">${escHtml(candidate.name)}</div>
        <div class="kx-user">${escHtml(candidate.username)}</div>
      </div>
    `;

    const select = () => { cleanup(); onSelect(candidate); };
    row.addEventListener('click', select);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); }
    });
    root.appendChild(row);
  }

  const footer = document.createElement('div');
  footer.className = 'kx-footer';
  footer.textContent = 'Esc to dismiss';
  root.appendChild(footer);

  shadow.appendChild(style);
  shadow.appendChild(root);

  positionBelow(host, anchor);
  document.body.appendChild(host);

  const onOutsideClick = (e: MouseEvent) => {
    if (!host.contains(e.target as Node)) { cleanup(); }
  };
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); cleanup(); }
  };

  const onScroll = () => positionBelow(host, anchor);

  document.addEventListener('click',   onOutsideClick, { capture: true, passive: true });
  document.addEventListener('keydown', onKeydown,       { capture: true });
  window.addEventListener('scroll',    onScroll,        { capture: true, passive: true });

  function cleanup() {
    document.removeEventListener('click',   onOutsideClick, { capture: true });
    document.removeEventListener('keydown', onKeydown,       { capture: true });
    window.removeEventListener('scroll',    onScroll,        { capture: true });
    host.remove();
  }

  return cleanup;
}

function positionBelow(host: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  host.style.cssText = [
    'position: fixed',
    `left: ${Math.round(rect.left)}px`,
    `top: ${Math.round(rect.bottom + 4)}px`,
    'z-index: 2147483647',
  ].join('; ');
}
