import { i18nService } from '@/services/i18n'
import type { IMPlatform } from '@/types/im'

import { platformMeta } from '../config/platformMeta'

interface IMPlatformHeaderProps {
  activePlatform: IMPlatform
  connected: boolean
  starting: boolean
}

export function IMPlatformHeader({ activePlatform, connected, starting }: IMPlatformHeaderProps) {
  return (
    <div className="flex items-center gap-3 pb-3 border-b dark:border-claude-darkBorder/60 border-claude-border/60">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white dark:bg-claude-darkBorder/30 p-1">
          <img
            src={platformMeta[activePlatform].logo}
            alt={platformMeta[activePlatform].label}
            className="w-4 h-4 object-contain rounded"
          />
        </div>
        <h3 className="text-sm font-medium dark:text-claude-darkText text-claude-text">
          {`${i18nService.t(activePlatform)}${i18nService.t('settings')}`}
        </h3>
      </div>
      <div
        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
          connected || starting
            ? 'bg-green-500/15 text-green-600 dark:text-green-400'
            : 'bg-gray-500/15 text-gray-500 dark:text-gray-400'
        }`}
      >
        {connected ? i18nService.t('connected') : starting ? i18nService.t('starting') || 'Starting' : i18nService.t('disconnected')}
      </div>
    </div>
  )
}