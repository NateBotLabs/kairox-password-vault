/**
 * Autofill — fills form fields with decrypted credentials.
 *
 * After the background validates the origin and returns credentials, this
 * module dispatches native input events so that React/Angular/Vue state
 * management picks up the changes.
 */

import type { DetectedForm } from './form-detector.js';

/**
 * Programmatically fill a form field, dispatching the events that frameworks
 * watch for (input, change). This is required for most SPA form libraries.
 */
function fillField(input: HTMLInputElement, value: string): void {
  // Use the native input value setter to bypass React's SyntheticEvent wrappers
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, value);
  } else {
    input.value = value;
  }

  input.dispatchEvent(new Event('input',  { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Fill both fields in the detected form. Focus the password field afterwards. */
export function fillForm(
  form: DetectedForm,
  username: string,
  password: string,
): void {
  if (form.usernameInput) {
    fillField(form.usernameInput, username);
  }
  fillField(form.passwordInput, password);
  form.passwordInput.focus();
}
