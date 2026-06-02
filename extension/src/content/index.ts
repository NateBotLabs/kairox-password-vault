/**
 * Content script entry point.
 *
 * Injected into every HTTPS page at document_idle.
 *
 * Flow:
 *  1. Detect login form(s) on the page (including dynamically added ones).
 *  2. On password field focus, ask the background for matching vault entries.
 *  3. If matches exist, mount the autofill overlay.
 *  4. When the user selects an entry, ask the background for decrypted
 *     credentials (background re-validates origin using sender.tab.url).
 *  5. Fill the form fields.
 *
 * Key security constraint: this script never holds plaintext passwords for
 * longer than the single synchronous fillForm() call.
 */

import { detectLoginForms, watchForForms } from './form-detector.js';
import { mountOverlay } from './overlay.js';
import { fillForm } from './autofill.js';
import type { AutofillCandidate, AutofillCredentials, BgRequest, BgResponse } from '../shared/messages.js';

function send<T>(req: BgRequest): Promise<BgResponse<T>> {
  return chrome.runtime.sendMessage(req) as Promise<BgResponse<T>>;
}

// Track which inputs already have the focus listener attached
const attached = new WeakSet<HTMLInputElement>();
let activeCleanup: (() => void) | null = null;

function dismissOverlay(): void {
  activeCleanup?.();
  activeCleanup = null;
}

async function handlePasswordFocus(form: {
  usernameInput: HTMLInputElement | null;
  passwordInput: HTMLInputElement;
}): Promise<void> {
  dismissOverlay();

  const resp = await send<AutofillCandidate[]>({
    type: 'LIST_ENTRIES_FOR_URL',
    url:  window.location.href,
  });

  if (!resp.ok || resp.data.length === 0) return;

  activeCleanup = mountOverlay(
    form.passwordInput,
    resp.data,
    async (candidate) => {
      const credResp = await send<AutofillCredentials>({
        type:         'AUTOFILL_REQUEST',
        entryId:      candidate.id,
        collectionId: candidate.collectionId,
      });

      if (!credResp.ok) return;
      fillForm(form, credResp.data.username, credResp.data.password);
    },
  );
}

function attachToForm(form: { usernameInput: HTMLInputElement | null; passwordInput: HTMLInputElement }): void {
  if (attached.has(form.passwordInput)) return;
  attached.add(form.passwordInput);

  form.passwordInput.addEventListener('focus', () => handlePasswordFocus(form), { passive: true });
}

function processForms(): void {
  const forms = detectLoginForms();
  forms.forEach(attachToForm);
}

// Initial scan
processForms();

// Watch for dynamically added forms (SPAs)
watchForForms((forms) => forms.forEach(attachToForm));

// Dismiss overlay on page navigation (SPA route change)
window.addEventListener('popstate', dismissOverlay);
