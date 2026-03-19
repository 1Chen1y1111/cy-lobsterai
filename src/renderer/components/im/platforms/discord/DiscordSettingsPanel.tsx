import { IMSecretInput } from '../../shared/IMSecretInput'
import type { IMSettingsControllerState } from '../../hooks/useIMSettingsController'
import { i18nService } from '@/services/i18n'

export function DiscordSettingsPanel({ controller }: { controller: IMSettingsControllerState }) {
  return (
    <div className="space-y-3">
      <IMSecretInput
        label="Bot Token"
        value={controller.config.discord.botToken}
        onChange={(value) => controller.updatePlatformConfig('discord', { botToken: value })}
        onBlur={() => void controller.handleSaveConfig()}
        placeholder="MTIzNDU2Nzg5MDEyMzQ1Njc4OQ..."
        hint="Get the bot token from Discord Developer Portal"
        clearLabel={i18nService.t('clear') || 'Clear'}
        showLabel={i18nService.t('show') || 'Show'}
        hideLabel={i18nService.t('hide') || 'Hide'}
        isVisible={controller.isSecretVisible('discord.botToken')}
        onToggleVisibility={() => controller.toggleSecret('discord.botToken')}
        onClear={() => {
          controller.updatePlatformConfig('discord', { botToken: '' })
          void controller.persistPlatformConfig('discord', { botToken: '' })
        }}
      />

      <div className="pt-1">{controller.renderConnectivityTestButton('discord')}</div>

      {controller.status.discord.botUsername ? (
        <div className="text-xs text-green-600 dark:text-green-400 bg-green-500/10 px-3 py-2 rounded-lg">
          Bot: {controller.status.discord.botUsername}
        </div>
      ) : null}

      {controller.status.discord.lastError ? (
        <div className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{controller.status.discord.lastError}</div>
      ) : null}
    </div>
  )
}
