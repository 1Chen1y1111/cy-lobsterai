import { XMarkIcon } from '@heroicons/react/24/outline'

import { i18nService } from '@/services/i18n'
import type { IMConnectivityCheck, IMConnectivityTestResult, IMPlatform } from '@/types/im'

import { checkLevelColorClass, verdictColorClass, verdictIconMap } from '../config/platformMeta'

interface IMConnectivityResultModalProps {
  platform: IMPlatform | null
  testingPlatform: IMPlatform | null
  results: Partial<Record<IMPlatform, IMConnectivityTestResult>>
  onClose: () => void
  onRetest: (platform: IMPlatform) => void
  getCheckTitle: (code: IMConnectivityCheck['code']) => string
  getCheckSuggestion: (check: IMConnectivityCheck) => string | undefined
  formatTestTime: (timestamp: number) => string
}

export function IMConnectivityResultModal({
  platform,
  testingPlatform,
  results,
  onClose,
  onRetest,
  getCheckTitle,
  getCheckSuggestion,
  formatTestTime
}: IMConnectivityResultModalProps) {
  if (!platform) return null

  const result = results[platform]
  const VerdictIcon = result ? verdictIconMap[result.verdict] : null

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl dark:bg-claude-darkSurface bg-claude-surface rounded-2xl shadow-modal border dark:border-claude-darkBorder border-claude-border overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-4 py-3 border-b dark:border-claude-darkBorder border-claude-border flex items-center justify-between">
          <div className="text-sm font-semibold dark:text-claude-darkText text-claude-text">
            {`${i18nService.t(platform)} ${i18nService.t('imConnectivitySectionTitle')}`}
          </div>
          <button
            type="button"
            aria-label={i18nService.t('close')}
            onClick={onClose}
            className="p-1 rounded-md dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover dark:text-claude-darkTextSecondary text-claude-textSecondary"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 max-h-[65vh] overflow-y-auto">
          {testingPlatform === platform ? (
            <div className="text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary">
              {i18nService.t('imConnectivityTesting')}
            </div>
          ) : result ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${verdictColorClass[result.verdict]}`}
                >
                  {VerdictIcon ? <VerdictIcon className="h-3.5 w-3.5" /> : null}
                  {i18nService.t(`imConnectivityVerdict_${result.verdict}`)}
                </div>
                <div className="text-[11px] dark:text-claude-darkTextSecondary text-claude-textSecondary">
                  {`${i18nService.t('imConnectivityLastChecked')}: ${formatTestTime(result.testedAt)}`}
                </div>
              </div>

              <div className="space-y-2">
                {result.checks.map((check, index) => (
                  <div
                    key={`${check.code}-${index}`}
                    className="rounded-lg border dark:border-claude-darkBorder/60 border-claude-border/60 px-2.5 py-2 dark:bg-claude-darkSurface/25 bg-white/70"
                  >
                    <div className={`text-xs font-medium ${checkLevelColorClass[check.level]}`}>{getCheckTitle(check.code)}</div>
                    <div className="mt-1 text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary">{check.message}</div>
                    {getCheckSuggestion(check) ? (
                      <div className="mt-1 text-[11px] dark:text-claude-darkTextSecondary text-claude-textSecondary">
                        {`${i18nService.t('imConnectivitySuggestion')}: ${getCheckSuggestion(check)}`}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary">
              {i18nService.t('imConnectivityNoResult')}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t dark:border-claude-darkBorder border-claude-border flex items-center justify-end">
          <button
            type="button"
            onClick={() => onRetest(platform)}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-xl border dark:border-claude-darkBorder border-claude-border dark:text-claude-darkText text-claude-text dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover transition-colors active:scale-[0.98]"
          >
            {i18nService.t('imConnectivityRetest')}
          </button>
        </div>
      </div>
    </div>
  )
}
