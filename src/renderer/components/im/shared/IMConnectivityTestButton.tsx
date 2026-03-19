import { connectivityButtonIcon as SignalIcon } from '../config/platformMeta'
import type { IMConnectivityTestButtonProps } from './types'

export function IMConnectivityTestButton({
  isLoading,
  hasResult,
  disabled,
  onClick,
  testingLabel,
  retestLabel,
  testLabel
}: IMConnectivityTestButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isLoading}
      className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-xl border dark:border-claude-darkBorder border-claude-border dark:text-claude-darkText text-claude-text dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98]"
    >
      <SignalIcon className="h-3.5 w-3.5 mr-1.5" />
      {isLoading ? testingLabel : hasResult ? retestLabel : testLabel}
    </button>
  )
}
