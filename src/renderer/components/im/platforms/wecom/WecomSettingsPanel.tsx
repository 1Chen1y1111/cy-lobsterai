import { IMSecretInput } from '../../shared/IMSecretInput'
import { IMTextField } from '../../shared/IMTextField'
import type { IMSettingsControllerState } from '../../hooks/useIMSettingsController'
import { i18nService } from '@/services/i18n'

export function WecomSettingsPanel({ controller }: { controller: IMSettingsControllerState }) {
  return (
    <div className="space-y-3">
      <IMTextField
        label="Bot ID"
        value={controller.config.wecom.botId}
        onChange={(value) => controller.updatePlatformConfig('wecom', { botId: value })}
        onBlur={() => void controller.handleSaveConfig()}
        placeholder={i18nService.t('wecomBotIdPlaceholder') || 'Your Bot ID'}
        clearLabel={i18nService.t('clear') || 'Clear'}
        onClear={() => {
          controller.updatePlatformConfig('wecom', { botId: '' })
          void controller.persistPlatformConfig('wecom', { botId: '' })
        }}
      />

      <IMSecretInput
        label="Secret"
        value={controller.config.wecom.secret}
        onChange={(value) => controller.updatePlatformConfig('wecom', { secret: value })}
        onBlur={() => void controller.handleSaveConfig()}
        placeholder="************"
        clearLabel={i18nService.t('clear') || 'Clear'}
        showLabel={i18nService.t('show') || 'Show'}
        hideLabel={i18nService.t('hide') || 'Hide'}
        isVisible={controller.isSecretVisible('wecom.secret')}
        onToggleVisibility={() => controller.toggleSecret('wecom.secret')}
        onClear={() => {
          controller.updatePlatformConfig('wecom', { secret: '' })
          void controller.persistPlatformConfig('wecom', { secret: '' })
        }}
      />

      <div className="pt-1">{controller.renderConnectivityTestButton('wecom')}</div>

      {controller.status.wecom?.botId ? (
        <div className="text-xs text-green-600 dark:text-green-400 bg-green-500/10 px-3 py-2 rounded-lg">
          Bot ID: {controller.status.wecom.botId}
        </div>
      ) : null}

      {controller.status.wecom?.lastError ? (
        <div className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{controller.status.wecom.lastError}</div>
      ) : null}
    </div>
  )
}
