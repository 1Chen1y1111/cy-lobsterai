import { XMarkIcon } from '@heroicons/react/24/outline'

import { IMSecretInput } from '../../shared/IMSecretInput'
import type { IMSettingsControllerState } from '../../hooks/useIMSettingsController'
import { i18nService } from '@/services/i18n'

export function TelegramSettingsPanel({ controller }: { controller: IMSettingsControllerState }) {
  return (
    <div className="space-y-3">
      <IMSecretInput
        label="Bot Token"
        value={controller.config.telegram.botToken}
        onChange={(value) => controller.updatePlatformConfig('telegram', { botToken: value })}
        onBlur={() => void controller.handleSaveConfig()}
        placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
        hint={i18nService.t('telegramTokenHint') || 'Get Bot Token from @BotFather'}
        clearLabel={i18nService.t('clear') || 'Clear'}
        showLabel={i18nService.t('show') || 'Show'}
        hideLabel={i18nService.t('hide') || 'Hide'}
        isVisible={controller.isSecretVisible('telegram.botToken')}
        onToggleVisibility={() => controller.toggleSecret('telegram.botToken')}
        onClear={() => {
          controller.updatePlatformConfig('telegram', { botToken: '' })
          void controller.persistPlatformConfig('telegram', { botToken: '' })
        }}
      />

      <div className="space-y-1.5">
        <label className="block text-xs font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
          Allowed User IDs
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={controller.allowedUserIdInput}
            onChange={(event) => controller.setAllowedUserIdInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void controller.addTelegramAllowedUserId()
              }
            }}
            className="block flex-1 rounded-lg dark:bg-claude-darkSurface/80 bg-claude-surface/80 dark:border-claude-darkBorder/60 border-claude-border/60 border focus:border-claude-accent focus:ring-1 focus:ring-claude-accent/30 dark:text-claude-darkText text-claude-text px-3 py-2 text-sm transition-colors"
            placeholder={i18nService.t('telegramAllowedUserIdsPlaceholder') || 'Enter Telegram User ID'}
          />
          <button
            type="button"
            onClick={() => {
              void controller.addTelegramAllowedUserId()
            }}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-claude-accent/10 text-claude-accent hover:bg-claude-accent/20 transition-colors"
          >
            {i18nService.t('add') || 'Add'}
          </button>
        </div>

        {(controller.config.telegram.allowedUserIds || []).length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {(controller.config.telegram.allowedUserIds || []).map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs dark:bg-claude-darkSurface/80 bg-claude-surface/80 dark:border-claude-darkBorder/60 border-claude-border/60 border dark:text-claude-darkText text-claude-text"
              >
                {id}
                <button
                  type="button"
                  onClick={() => {
                    void controller.removeTelegramAllowedUserId(id)
                  }}
                  className="text-claude-textSecondary dark:text-claude-darkTextSecondary hover:text-red-500 dark:hover:text-red-400 transition-colors"
                >
                  <XMarkIcon className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <p className="text-xs text-claude-textSecondary dark:text-claude-darkTextSecondary">
          {i18nService.t('telegramAllowedUserIdsHint') || 'Restrict bot access to listed users. Leave empty to allow all users.'}
        </p>
      </div>

      <div className="pt-1">{controller.renderConnectivityTestButton('telegram')}</div>

      {controller.status.telegram.botUsername ? (
        <div className="text-xs text-green-600 dark:text-green-400 bg-green-500/10 px-3 py-2 rounded-lg">
          Bot: @{controller.status.telegram.botUsername}
        </div>
      ) : null}

      {controller.status.telegram.lastError ? (
        <div className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{controller.status.telegram.lastError}</div>
      ) : null}
    </div>
  )
}
