import { IMSecretInput } from '../../shared/IMSecretInput'
import { IMTextField } from '../../shared/IMTextField'
import type { IMSettingsControllerState } from '../../hooks/useIMSettingsController'
import { i18nService } from '@/services/i18n'

export function NimSettingsPanel({ controller }: { controller: IMSettingsControllerState }) {
  return (
    <div className="space-y-3">
      <div className="mb-3 p-3 rounded-lg bg-blue-50/50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/30">
        <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
          {i18nService.t('nimCredentialsGuide') || 'How to get NetEase IM credentials:'}
        </p>
        <ol className="mt-2 text-xs text-blue-600 dark:text-blue-400 space-y-1 list-decimal list-inside">
          <li>{i18nService.t('nimGuideStep1') || 'Log in to NetEase IM Console (yunxin.163.com)'}</li>
          <li>{i18nService.t('nimGuideStep2') || 'Create or select an app and get the App Key'}</li>
          <li>{i18nService.t('nimGuideStep3') || 'Create an IM account (accid) in Account Management'}</li>
          <li>{i18nService.t('nimGuideStep4') || 'Generate a long-lived token for that account'}</li>
        </ol>
      </div>

      <IMTextField
        label="App Key"
        value={controller.config.nim.appKey}
        onChange={(value) => controller.updatePlatformConfig('nim', { appKey: value })}
        onBlur={() => void controller.handleSaveConfig()}
        placeholder="your_app_key"
        hint={i18nService.t('nimAppKeyHint') || 'Get this from the app details in the NetEase IM console'}
        clearLabel={i18nService.t('clear') || 'Clear'}
        onClear={() => {
          controller.updatePlatformConfig('nim', { appKey: '' })
          void controller.persistPlatformConfig('nim', { appKey: '' })
        }}
      />

      <IMTextField
        label="Account (accid)"
        value={controller.config.nim.account}
        onChange={(value) => controller.updatePlatformConfig('nim', { account: value })}
        onBlur={() => void controller.handleSaveConfig()}
        placeholder={i18nService.t('nimAccountPlaceholder') || 'bot_account_id'}
        hint={i18nService.t('nimAccountHint') || 'The IM account ID created in NetEase IM account management'}
        clearLabel={i18nService.t('clear') || 'Clear'}
        onClear={() => {
          controller.updatePlatformConfig('nim', { account: '' })
          void controller.persistPlatformConfig('nim', { account: '' })
        }}
      />

      <IMSecretInput
        label="Token"
        value={controller.config.nim.token}
        onChange={(value) => controller.updatePlatformConfig('nim', { token: value })}
        onBlur={() => void controller.handleSaveConfig()}
        placeholder="************"
        hint={i18nService.t('nimTokenHint') || 'Use a long-lived token generated for the selected IM account'}
        clearLabel={i18nService.t('clear') || 'Clear'}
        showLabel={i18nService.t('show') || 'Show'}
        hideLabel={i18nService.t('hide') || 'Hide'}
        isVisible={controller.isSecretVisible('nim.token')}
        onToggleVisibility={() => controller.toggleSecret('nim.token')}
        onClear={() => {
          controller.updatePlatformConfig('nim', { token: '' })
          void controller.persistPlatformConfig('nim', { token: '' })
        }}
      />

      <IMTextField
        label={i18nService.t('nimAccountWhitelist') || 'Account whitelist'}
        value={controller.config.nim.accountWhitelist}
        onChange={(value) => controller.updatePlatformConfig('nim', { accountWhitelist: value })}
        onBlur={() => void controller.handleSaveConfig()}
        placeholder="account1,account2"
        hint={i18nService.t('nimAccountWhitelistHint') || 'Enter allowed IM account IDs, separated by commas. Leave empty to allow all accounts.'}
        clearLabel={i18nService.t('clear') || 'Clear'}
        onClear={() => {
          controller.updatePlatformConfig('nim', { accountWhitelist: '' })
          void controller.persistPlatformConfig('nim', { accountWhitelist: '' })
        }}
      />

      <div className="space-y-1.5">
        <label className="block text-xs font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
          {i18nService.t('nimTeamPolicy') || 'Team message policy'}
        </label>
        <select
          value={controller.config.nim.teamPolicy || 'disabled'}
          onChange={(event) => {
            const value = event.target.value as 'disabled' | 'open' | 'allowlist'
            controller.updatePlatformConfig('nim', { teamPolicy: value })
            void controller.saveNimConfigWithUpdate({ teamPolicy: value })
          }}
          className="block w-full rounded-lg dark:bg-claude-darkSurface/80 bg-claude-surface/80 dark:border-claude-darkBorder/60 border-claude-border/60 border focus:border-claude-accent focus:ring-1 focus:ring-claude-accent/30 dark:text-claude-darkText text-claude-text px-3 py-2 text-sm transition-colors"
        >
          <option value="disabled">{i18nService.t('nimTeamPolicyDisabled') || 'Disabled - do not respond to team messages'}</option>
          <option value="open">{i18nService.t('nimTeamPolicyOpen') || 'Open - respond to @mentions in all teams'}</option>
          <option value="allowlist">{i18nService.t('nimTeamPolicyAllowlist') || 'Allowlist - respond to @mentions in specified teams'}</option>
        </select>
        <p className="text-xs text-claude-textSecondary dark:text-claude-darkTextSecondary">
          {i18nService.t('nimTeamPolicyHint') || 'Only respond to @mentions in team messages'}
        </p>
      </div>

      {controller.config.nim.teamPolicy === 'allowlist' ? (
        <IMTextField
          label={i18nService.t('nimTeamAllowlist') || 'Team allowlist'}
          value={controller.config.nim.teamAllowlist || ''}
          onChange={(value) => controller.updatePlatformConfig('nim', { teamAllowlist: value })}
          onBlur={() => void controller.handleSaveConfig()}
          placeholder="team_id_1,team_id_2"
          hint={i18nService.t('nimTeamAllowlistHint') || 'Enter allowed team IDs, separated by commas'}
        />
      ) : null}

      <div className="flex items-center justify-between py-2">
        <div>
          <label className="block text-xs font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
            {i18nService.t('nimQChatEnabled') || 'Enable QChat'}
          </label>
          <p className="text-xs text-claude-textSecondary dark:text-claude-darkTextSecondary mt-0.5">
            {i18nService.t('nimQChatEnabledHint') || 'Subscribe to QChat messages and only respond to @mentions'}
          </p>
        </div>
        <div
          className={`w-10 h-5 rounded-full flex items-center transition-colors cursor-pointer ${
            controller.config.nim.qchatEnabled ? 'bg-green-500' : 'dark:bg-claude-darkBorder bg-claude-border'
          }`}
          onClick={() => {
            const nextValue = !controller.config.nim.qchatEnabled
            controller.updatePlatformConfig('nim', { qchatEnabled: nextValue })
            void controller.saveNimConfigWithUpdate({ qchatEnabled: nextValue })
          }}
        >
          <div
            className={`w-4 h-4 rounded-full bg-white shadow-md transform transition-transform ${
              controller.config.nim.qchatEnabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </div>
      </div>

      {controller.config.nim.qchatEnabled ? (
        <IMTextField
          label={i18nService.t('nimQChatServerIds') || 'QChat server IDs'}
          value={controller.config.nim.qchatServerIds || ''}
          onChange={(value) => controller.updatePlatformConfig('nim', { qchatServerIds: value })}
          onBlur={() => void controller.handleSaveConfig()}
          placeholder={i18nService.t('nimQChatServerIdsPlaceholder') || 'Leave empty to auto-discover joined servers'}
          hint={
            i18nService.t('nimQChatServerIdsHint') ||
            'Specify server IDs to subscribe to, separated by commas. Leave empty to subscribe to all joined servers.'
          }
        />
      ) : null}

      <div className="pt-1">{controller.renderConnectivityTestButton('nim')}</div>

      {controller.status.nim.botAccount ? (
        <div className="text-xs text-green-600 dark:text-green-400 bg-green-500/10 px-3 py-2 rounded-lg">
          Account: {controller.status.nim.botAccount}
        </div>
      ) : null}

      {controller.status.nim.lastError ? (
        <div className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{controller.status.nim.lastError}</div>
      ) : null}
    </div>
  )
}
