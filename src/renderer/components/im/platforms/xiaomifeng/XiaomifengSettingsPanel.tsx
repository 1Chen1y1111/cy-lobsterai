import { i18nService } from '@/services/i18n'

import { translateIMError } from '../../config/platformMeta'
import type { IMSettingsControllerState } from '../../hooks/useIMSettingsController'
import { IMSecretInput } from '../../shared/IMSecretInput'
import { IMTextField } from '../../shared/IMTextField'

export function XiaomifengSettingsPanel({ controller }: { controller: IMSettingsControllerState }) {
  return (
    <div className="space-y-3">
      <IMTextField
        label="Client ID"
        value={controller.config.xiaomifeng.clientId}
        onChange={(value) => controller.updatePlatformConfig('xiaomifeng', { clientId: value })}
        onBlur={() => void controller.handleSaveConfig()}
        placeholder={i18nService.t('xiaomifengClientIdPlaceholder') || 'Your Client ID'}
        clearLabel={i18nService.t('clear') || 'Clear'}
        onClear={() => {
          controller.updatePlatformConfig('xiaomifeng', { clientId: '' })
          void controller.persistPlatformConfig('xiaomifeng', { clientId: '' })
        }}
      />

      <IMSecretInput
        label="Client Secret"
        value={controller.config.xiaomifeng.secret}
        onChange={(value) => controller.updatePlatformConfig('xiaomifeng', { secret: value })}
        onBlur={() => void controller.handleSaveConfig()}
        placeholder="************"
        clearLabel={i18nService.t('clear') || 'Clear'}
        showLabel={i18nService.t('show') || 'Show'}
        hideLabel={i18nService.t('hide') || 'Hide'}
        isVisible={controller.isSecretVisible('xiaomifeng.secret')}
        onToggleVisibility={() => controller.toggleSecret('xiaomifeng.secret')}
        onClear={() => {
          controller.updatePlatformConfig('xiaomifeng', { secret: '' })
          void controller.persistPlatformConfig('xiaomifeng', { secret: '' })
        }}
      />

      <div className="pt-1">{controller.renderConnectivityTestButton('xiaomifeng')}</div>

      {controller.status.xiaomifeng?.botAccount ? (
        <div className="text-xs text-green-600 dark:text-green-400 bg-green-500/10 px-3 py-2 rounded-lg">
          Account: {controller.status.xiaomifeng.botAccount}
        </div>
      ) : null}

      {controller.status.xiaomifeng?.lastError ? (
        <div className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">
          {translateIMError(controller.status.xiaomifeng.lastError)}
        </div>
      ) : null}
    </div>
  )
}
