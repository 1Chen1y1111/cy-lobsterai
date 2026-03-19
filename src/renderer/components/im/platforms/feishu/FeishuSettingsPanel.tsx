import { IMSecretInput } from '../../shared/IMSecretInput'
import { IMTextField } from '../../shared/IMTextField'
import type { IMSettingsControllerState } from '../../hooks/useIMSettingsController'
import { i18nService } from '@/services/i18n'

export function FeishuSettingsPanel({ controller }: { controller: IMSettingsControllerState }) {
  return (
    <div className="space-y-3">
      <IMTextField
        label="App ID"
        value={controller.config.feishu.appId}
        onChange={(value) => controller.updatePlatformConfig('feishu', { appId: value })}
        onBlur={() => void controller.handleSaveConfig()}
        placeholder="cli_xxxxx"
        clearLabel={i18nService.t('clear') || 'Clear'}
        onClear={() => {
          controller.updatePlatformConfig('feishu', { appId: '' })
          void controller.persistPlatformConfig('feishu', { appId: '' })
        }}
      />

      <IMSecretInput
        label="App Secret"
        value={controller.config.feishu.appSecret}
        onChange={(value) => controller.updatePlatformConfig('feishu', { appSecret: value })}
        onBlur={() => void controller.handleSaveConfig()}
        placeholder="************"
        clearLabel={i18nService.t('clear') || 'Clear'}
        showLabel={i18nService.t('show') || 'Show'}
        hideLabel={i18nService.t('hide') || 'Hide'}
        isVisible={controller.isSecretVisible('feishu.appSecret')}
        onToggleVisibility={() => controller.toggleSecret('feishu.appSecret')}
        onClear={() => {
          controller.updatePlatformConfig('feishu', { appSecret: '' })
          void controller.persistPlatformConfig('feishu', { appSecret: '' })
        }}
      />

      <div className="pt-1">{controller.renderConnectivityTestButton('feishu')}</div>

      {controller.status.feishu.error ? (
        <div className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{controller.status.feishu.error}</div>
      ) : null}
    </div>
  )
}
