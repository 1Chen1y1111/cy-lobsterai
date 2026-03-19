import { IMSecretInput } from '../../shared/IMSecretInput'
import { IMTextField } from '../../shared/IMTextField'
import type { IMSettingsControllerState } from '../../hooks/useIMSettingsController'
import { i18nService } from '@/services/i18n'

export function DingTalkSettingsPanel({ controller }: { controller: IMSettingsControllerState }) {
  return (
    <div className="space-y-3">
      <IMTextField
        label="Client ID (AppKey)"
        value={controller.config.dingtalk.clientId}
        onChange={(value) => controller.updatePlatformConfig('dingtalk', { clientId: value })}
        onBlur={() => void controller.handleSaveConfig()}
        placeholder="dingxxxxxx"
        clearLabel={i18nService.t('clear') || 'Clear'}
        onClear={() => {
          controller.updatePlatformConfig('dingtalk', { clientId: '' })
          void controller.persistPlatformConfig('dingtalk', { clientId: '' })
        }}
      />

      <IMSecretInput
        label="Client Secret (AppSecret)"
        value={controller.config.dingtalk.clientSecret}
        onChange={(value) => controller.updatePlatformConfig('dingtalk', { clientSecret: value })}
        onBlur={() => void controller.handleSaveConfig()}
        placeholder="************"
        clearLabel={i18nService.t('clear') || 'Clear'}
        showLabel={i18nService.t('show') || 'Show'}
        hideLabel={i18nService.t('hide') || 'Hide'}
        isVisible={controller.isSecretVisible('dingtalk.clientSecret')}
        onToggleVisibility={() => controller.toggleSecret('dingtalk.clientSecret')}
        onClear={() => {
          controller.updatePlatformConfig('dingtalk', { clientSecret: '' })
          void controller.persistPlatformConfig('dingtalk', { clientSecret: '' })
        }}
      />

      <div className="pt-1">{controller.renderConnectivityTestButton('dingtalk')}</div>

      {controller.status.dingtalk.lastError ? (
        <div className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{controller.status.dingtalk.lastError}</div>
      ) : null}
    </div>
  )
}
