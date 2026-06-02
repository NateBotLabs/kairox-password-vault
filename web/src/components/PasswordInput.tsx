import { InputHTMLAttributes, useState } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value'> {
  value: string;
  onChange: (v: string) => void;
  showCopy?: boolean;
}

export default function PasswordInput({ value, onChange, showCopy = false, ...rest }: Props) {
  const [visible, setVisible]  = useState(false);
  const [copied, setCopied]    = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="relative">
      <input
        {...rest}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`input pr-${showCopy ? '20' : '10'}`}
      />
      <div className="absolute inset-y-0 right-0 flex items-center gap-0.5 pr-2">
        {showCopy && value && (
          <button
            type="button"
            onClick={copy}
            className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors rounded"
            title="Copy"
          >
            {copied ? '✓' : '⎘'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setVisible(v => !v)}
          className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors rounded"
          title={visible ? 'Hide' : 'Show'}
        >
          {visible ? '🙈' : '👁'}
        </button>
      </div>
    </div>
  );
}
