import { EyeIcon, EyeSlashIcon, XCircleIcon as XCircleIconSolid } from '@heroicons/react/20/solid';

import type { IMSecretInputProps } from './types';

export function IMSecretInput({
  label,
  value,
  placeholder,
  onChange,
  onBlur,
  onClear,
  clearLabel = 'Clear',
  hint,
  isVisible,
  onToggleVisibility,
  showLabel = 'Show',
  hideLabel = 'Hide',
}: IMSecretInputProps) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
        {label}
      </label>
      <div className="relative">
        <input
          type={isVisible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          className="block w-full rounded-lg dark:bg-claude-darkSurface/80 bg-claude-surface/80 dark:border-claude-darkBorder/60 border-claude-border/60 border focus:border-claude-accent focus:ring-1 focus:ring-claude-accent/30 dark:text-claude-darkText text-claude-text px-3 py-2 pr-16 text-sm transition-colors"
          placeholder={placeholder}
        />
        <div className="absolute right-2 inset-y-0 flex items-center gap-1">
          {value && onClear ? (
            <button
              type="button"
              onClick={onClear}
              className="p-0.5 rounded text-claude-textSecondary dark:text-claude-darkTextSecondary hover:text-claude-accent transition-colors"
              title={clearLabel}
            >
              <XCircleIconSolid className="h-4 w-4" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onToggleVisibility}
            className="p-0.5 rounded text-claude-textSecondary dark:text-claude-darkTextSecondary hover:text-claude-accent transition-colors"
            title={isVisible ? hideLabel : showLabel}
          >
            {isVisible ? <EyeIcon className="h-4 w-4" /> : <EyeSlashIcon className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {hint ? (
        <p className="text-xs text-claude-textSecondary dark:text-claude-darkTextSecondary">{hint}</p>
      ) : null}
    </div>
  );
}