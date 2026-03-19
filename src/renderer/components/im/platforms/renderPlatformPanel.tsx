import type { IMSettingsControllerState } from '../hooks/useIMSettingsController'

import { DingTalkSettingsPanel } from './dingtalk/DingTalkSettingsPanel'
import { DiscordSettingsPanel } from './discord/DiscordSettingsPanel'
import { FeishuSettingsPanel } from './feishu/FeishuSettingsPanel'
import { NimSettingsPanel } from './nim/NimSettingsPanel'
import { QQSettingsPanel } from './qq/QQSettingsPanel'
import { TelegramSettingsPanel } from './telegram/TelegramSettingsPanel'
import { WecomSettingsPanel } from './wecom/WecomSettingsPanel'
import { XiaomifengSettingsPanel } from './xiaomifeng/XiaomifengSettingsPanel'

export function renderPlatformPanel(controller: IMSettingsControllerState) {
  switch (controller.activePlatform) {
    case 'dingtalk':
      return <DingTalkSettingsPanel controller={controller} />
    case 'feishu':
      return <FeishuSettingsPanel controller={controller} />
    case 'qq':
      return <QQSettingsPanel controller={controller} />
    case 'telegram':
      return <TelegramSettingsPanel controller={controller} />
    case 'discord':
      return <DiscordSettingsPanel controller={controller} />
    case 'nim':
      return <NimSettingsPanel controller={controller} />
    case 'xiaomifeng':
      return <XiaomifengSettingsPanel controller={controller} />
    case 'wecom':
      return <WecomSettingsPanel controller={controller} />
    default:
      return null
  }
}
