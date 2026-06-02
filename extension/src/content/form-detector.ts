/**
 * Detects login forms on the current page.
 *
 * A "login form" is defined as any visible <input type="password"> plus an
 * optional associated username/email field found nearby in the DOM.
 * A MutationObserver is used to catch forms added dynamically by SPAs.
 */

export interface DetectedForm {
  usernameInput: HTMLInputElement | null;
  passwordInput: HTMLInputElement;
}

const USERNAME_AC_VALUES = ['username', 'email', 'tel', 'nickname'];
const USERNAME_NAME_HINTS = ['user', 'email', 'login', 'account', 'id', 'name'];

function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
}

function isUsernameField(el: HTMLInputElement): boolean {
  if (el.type === 'email') return true;

  const ac = el.autocomplete?.toLowerCase() ?? '';
  if (USERNAME_AC_VALUES.some(v => ac.includes(v))) return true;

  const hint = (el.name + ' ' + el.id + ' ' + el.placeholder).toLowerCase();
  return USERNAME_NAME_HINTS.some(h => hint.includes(h));
}

export function detectLoginForms(): DetectedForm[] {
  const passwordInputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  ).filter(isVisible);

  return passwordInputs.map(passwordInput => {
    const form = passwordInput.closest('form');
    let usernameInput: HTMLInputElement | null = null;

    if (form) {
      usernameInput =
        form.querySelector<HTMLInputElement>('input[autocomplete="email"], input[autocomplete="username"]') ??
        Array.from(form.querySelectorAll<HTMLInputElement>('input')).find(isUsernameField) ?? null;
    }

    if (!usernameInput) {
      const all   = Array.from(document.querySelectorAll<HTMLInputElement>('input'));
      const pwIdx = all.indexOf(passwordInput);
      for (let i = pwIdx - 1; i >= Math.max(0, pwIdx - 6); i--) {
        if (isVisible(all[i]) && isUsernameField(all[i])) {
          usernameInput = all[i];
          break;
        }
      }
    }

    return { usernameInput, passwordInput };
  });
}

/**
 * Watches for DOM mutations and calls `callback` when new password inputs appear.
 * Returns the observer so the caller can disconnect it.
 */
export function watchForForms(callback: (forms: DetectedForm[]) => void): MutationObserver {
  let debounce: ReturnType<typeof setTimeout>;

  const observer = new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const forms = detectLoginForms();
      if (forms.length > 0) callback(forms);
    }, 250);
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  return observer;
}
