import { IMSecretInput } from '../../shared/IMSecretInput'
import { IMTextField } from '../../shared/IMTextField'
import type { IMSettingsControllerState } from '../../hooks/useIMSettingsController'
import { i18nService } from '@/services/i18n'

export function QQSettingsPanel({ controller }: { controller: IMSettingsControllerState }) {
  return (
    <div className="space-y-3">
      <IMTextField
        label="AppID"
        value={controller.config.qq.appId}
        onChange={(value) => controller.updatePlatformConfig('qq', { appId: value })}
        onBlur={() => void controller.handleSaveConfig()}
        placeholder="102xxxxx"
        clearLabel={i18nService.t('clear') || 'Clear'}
        onClear={() => {
          controller.updatePlatformConfig('qq', { appId: '' })
          void controller.persistPlatformConfig('qq', { appId: '' })
        }}
      />

      <IMSecretInput
        label="AppSecret"
        value={controller.config.qq.appSecret}
        onChange={(value) => controller.updatePlatformConfig('qq', { appSecret: value })}
        onBlur={() => void controller.handleSaveConfig()}
        placeholder="************"
        clearLabel={i18nService.t('clear') || 'Clear'}
        showLabel={i18nService.t('show') || 'Show'}
        hideLabel={i18nService.t('hide') || 'Hide'}
        isVisible={controller.isSecretVisible('qq.appSecret')}
        onToggleVisibility={() => controller.toggleSecret('qq.appSecret')}
        onClear={() => {
          controller.updatePlatformConfig('qq', { appSecret: '' })
          void controller.persistPlatformConfig('qq', { appSecret: '' })
        }}
      />

      <div className="pt-1">{controller.renderConnectivityTestButton('qq')}</div>

      {controller.status.qq?.lastError ? (
        <div className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{controller.status.qq.lastError}</div>
      ) : null}
    </div>
  )
}
