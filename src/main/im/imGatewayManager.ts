/**
 * IM 网关管理器。
 * 负责统一管理各个平台网关的生命周期、配置热更新、消息路由、
 * 连通性测试，以及与 Cowork / Chat 处理器之间的协作。
 */

import { EventEmitter } from 'events'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import { DingTalkGateway } from './dingtalkGateway'
import { FeishuGateway } from './feishuGateway'
import { TelegramGateway } from './telegramGateway'
import { DiscordGateway } from './discordGateway'
import { NimGateway } from './nimGateway'
import { XiaomifengGateway } from './xiaomifengGateway'
import { QQGateway } from './qqGateway'
import { WecomGateway } from './wecomGateway'
import { IMChatHandler } from './imChatHandler'
import { IMCoworkHandler } from './imCoworkHandler'
import { IMStore } from './imStore'
import { getOapiAccessToken } from './dingtalkMedia'
import { fetchJsonWithTimeout } from './http'
import {
  IMGatewayConfig,
  IMGatewayStatus,
  IMPlatform,
  IMMessage,
  IMConnectivityCheck,
  IMConnectivityTestResult,
  IMConnectivityVerdict
} from './types'
import type { Database } from 'sql.js'
import type { CoworkRunner } from '../libs/coworkRunner'
import type { CoworkStore } from '../coworkStore'
/** 单次鉴权或探活检查的超时时间。 */
const CONNECTIVITY_TIMEOUT_MS = 10_000
/** 网关启动后一段时间内若还没有入站消息，则给出提醒。 */
const INBOUND_ACTIVITY_WARN_AFTER_MS = 2 * 60 * 1000

/** Telegram `getMe` 接口的最小返回结构。 */
interface TelegramGetMeResponse {
  ok?: boolean
  result?: {
    username?: string
  }
  description?: string
}

/** Discord 鉴权接口的最小返回结构。 */
interface DiscordUserResponse {
  username?: string
  discriminator?: string
}

/** 构造管理器时可选注入的 Cowork 依赖。 */
export interface IMGatewayManagerOptions {
  coworkRunner?: CoworkRunner
  coworkStore?: CoworkStore
}

/**
 * 统一封装所有 IM 平台网关的运行态协调逻辑。
 * 这一层向上提供统一接口，向下屏蔽各平台 SDK 与协议差异。
 */
export class IMGatewayManager extends EventEmitter {
  /** 钉钉网关实例。 */
  private dingtalkGateway: DingTalkGateway
  /** 飞书网关实例。 */
  private feishuGateway: FeishuGateway
  /** Telegram 网关实例。 */
  private telegramGateway: TelegramGateway
  /** Discord 网关实例。 */
  private discordGateway: DiscordGateway
  /** 网易云信网关实例。 */
  private nimGateway: NimGateway
  /** 小蜜蜂网关实例。 */
  private xiaomifengGateway: XiaomifengGateway
  /** QQ 机器人网关实例。 */
  private qqGateway: QQGateway
  /** 企业微信网关实例。 */
  private wecomGateway: WecomGateway
  /** IM 持久化存储，负责配置与会话映射。 */
  private imStore: IMStore
  /** 普通聊天模式处理器。 */
  private chatHandler: IMChatHandler | null = null
  /** Cowork 模式处理器，优先级高于普通聊天。 */
  private coworkHandler: IMCoworkHandler | null = null
  /** 读取当前 LLM 配置的回调，由上层注入。 */
  private getLLMConfig: (() => Promise<any>) | null = null
  /** 生成技能自动路由提示词的回调，由上层注入。 */
  private getSkillsPrompt: (() => Promise<string | null>) | null = null

  /** Cowork 运行器，用于工具调用和长会话执行。 */
  private coworkRunner: CoworkRunner | null = null
  /** Cowork 持久层，用于查找和复用会话。 */
  private coworkStore: CoworkStore | null = null

  /** NIM 探活互斥锁，避免并发测试创建多个 SDK 实例。 */
  private nimProbePromise: Promise<void> | null = null

  /**
   * 创建管理器并实例化所有平台网关。
   * 构造时会完成事件转发绑定，但不会主动启动任何网关。
   */
  constructor(db: Database, saveDb: () => void, options?: IMGatewayManagerOptions) {
    super()

    this.imStore = new IMStore(db, saveDb)
    this.dingtalkGateway = new DingTalkGateway()
    this.feishuGateway = new FeishuGateway()
    this.telegramGateway = new TelegramGateway()
    this.discordGateway = new DiscordGateway()
    this.nimGateway = new NimGateway()
    this.xiaomifengGateway = new XiaomifengGateway()
    this.qqGateway = new QQGateway()
    this.wecomGateway = new WecomGateway()

    // 保存可选的 Cowork 依赖，后续在消息到来时再按需启用。
    if (options?.coworkRunner && options?.coworkStore) {
      this.coworkRunner = options.coworkRunner
      this.coworkStore = options.coworkStore
    }

    // 将底层网关事件统一转发到 manager 层，方便 main / renderer 订阅。
    this.setupGatewayEventForwarding()
  }

  /**
   * 绑定所有平台网关的事件转发。
   * 这里统一把底层 connected / disconnected / error / message
   * 转换成 manager 层的标准事件。
   */
  private setupGatewayEventForwarding(): void {
    // 钉钉事件
    this.dingtalkGateway.on('connected', () => {
      this.emit('statusChange', this.getStatus())
    })
    this.dingtalkGateway.on('disconnected', () => {
      this.emit('statusChange', this.getStatus())
    })
    this.dingtalkGateway.on('error', (error) => {
      this.emit('error', { platform: 'dingtalk', error })
      this.emit('statusChange', this.getStatus())
    })
    this.dingtalkGateway.on('message', (message: IMMessage) => {
      this.emit('message', message)
    })

    // 飞书事件
    this.feishuGateway.on('connected', () => {
      this.emit('statusChange', this.getStatus())
    })
    this.feishuGateway.on('disconnected', () => {
      this.emit('statusChange', this.getStatus())
    })
    this.feishuGateway.on('error', (error) => {
      this.emit('error', { platform: 'feishu', error })
      this.emit('statusChange', this.getStatus())
    })
    this.feishuGateway.on('message', (message: IMMessage) => {
      this.emit('message', message)
    })

    // Telegram 事件
    this.telegramGateway.on('connected', () => {
      this.emit('statusChange', this.getStatus())
    })
    this.telegramGateway.on('disconnected', () => {
      this.emit('statusChange', this.getStatus())
    })
    this.telegramGateway.on('error', (error) => {
      this.emit('error', { platform: 'telegram', error })
      this.emit('statusChange', this.getStatus())
    })
    this.telegramGateway.on('message', (message: IMMessage) => {
      this.emit('message', message)
    })

    // Discord 事件
    this.discordGateway.on('status', () => {
      this.emit('statusChange', this.getStatus())
    })
    this.discordGateway.on('connected', () => {
      this.emit('statusChange', this.getStatus())
    })
    this.discordGateway.on('disconnected', () => {
      this.emit('statusChange', this.getStatus())
    })
    this.discordGateway.on('error', (error) => {
      this.emit('error', { platform: 'discord', error })
      this.emit('statusChange', this.getStatus())
    })
    this.discordGateway.on('message', (message: IMMessage) => {
      this.emit('message', message)
    })

    // NIM 事件
    this.nimGateway.on('status', () => {
      this.emit('statusChange', this.getStatus())
    })
    this.nimGateway.on('connected', () => {
      this.emit('statusChange', this.getStatus())
    })
    this.nimGateway.on('disconnected', () => {
      this.emit('statusChange', this.getStatus())
    })
    this.nimGateway.on('error', (error) => {
      this.emit('error', { platform: 'nim', error })
      this.emit('statusChange', this.getStatus())
    })
    this.nimGateway.on('message', (message: IMMessage) => {
      this.emit('message', message)
    })

    // 小蜜蜂事件
    this.xiaomifengGateway.on('status', () => {
      this.emit('statusChange', this.getStatus())
    })
    this.xiaomifengGateway.on('connected', () => {
      this.emit('statusChange', this.getStatus())
    })
    this.xiaomifengGateway.on('disconnected', () => {
      this.emit('statusChange', this.getStatus())
    })
    this.xiaomifengGateway.on('error', (error) => {
      this.emit('error', { platform: 'xiaomifeng', error })
      this.emit('statusChange', this.getStatus())
    })
    this.xiaomifengGateway.on('message', (message: IMMessage) => {
      this.emit('message', message)
    })

    // QQ 事件
    this.qqGateway.on('connected', () => {
      this.emit('statusChange', this.getStatus())
    })
    this.qqGateway.on('disconnected', () => {
      this.emit('statusChange', this.getStatus())
    })
    this.qqGateway.on('error', (error) => {
      this.emit('error', { platform: 'qq', error })
      this.emit('statusChange', this.getStatus())
    })
    this.qqGateway.on('message', (message: IMMessage) => {
      this.emit('message', message)
    })

    // 企业微信事件
    this.wecomGateway.on('status', () => {
      this.emit('statusChange', this.getStatus())
    })
    this.wecomGateway.on('connected', () => {
      this.emit('statusChange', this.getStatus())
    })
    this.wecomGateway.on('disconnected', () => {
      this.emit('statusChange', this.getStatus())
    })
    this.wecomGateway.on('error', (error) => {
      this.emit('error', { platform: 'wecom', error })
      this.emit('statusChange', this.getStatus())
    })
    this.wecomGateway.on('message', (message: IMMessage) => {
      this.emit('message', message)
    })
  }

  /**
   * 网络恢复后尝试重连所有已断开的网关。
   * 这是一个“尽力而为”的恢复动作，不会因为单个平台失败而中断整体流程。
   */
  reconnectAllDisconnected(): void {
    console.log('[IMGatewayManager] Reconnecting all disconnected gateways...')

    if (this.dingtalkGateway && !this.dingtalkGateway.isConnected()) {
      console.log('[IMGatewayManager] Reconnecting DingTalk...')
      this.dingtalkGateway.reconnectIfNeeded()
    }

    if (this.feishuGateway && !this.feishuGateway.isConnected()) {
      console.log('[IMGatewayManager] Reconnecting Feishu...')
      this.feishuGateway.reconnectIfNeeded()
    }

    if (this.telegramGateway && !this.telegramGateway.isConnected()) {
      console.log('[IMGatewayManager] Reconnecting Telegram...')
      this.telegramGateway.reconnectIfNeeded()
    }

    if (this.discordGateway && !this.discordGateway.isConnected()) {
      console.log('[IMGatewayManager] Reconnecting Discord...')
      this.discordGateway.reconnectIfNeeded()
    }

    if (this.nimGateway && !this.nimGateway.isConnected()) {
      console.log('[IMGatewayManager] Reconnecting NIM...')
      this.nimGateway.reconnectIfNeeded()
    }

    if (this.xiaomifengGateway && !this.xiaomifengGateway.isConnected()) {
      console.log('[IMGatewayManager] Reconnecting Xiaomifeng...')
      this.xiaomifengGateway.reconnectIfNeeded()
    }

    if (this.qqGateway && !this.qqGateway.isConnected()) {
      console.log('[IMGatewayManager] Reconnecting QQ...')
      this.qqGateway.reconnectIfNeeded()
    }

    if (this.wecomGateway && !this.wecomGateway.isConnected()) {
      console.log('[IMGatewayManager] Reconnecting WeCom...')
      this.wecomGateway.reconnectIfNeeded()
    }
  }

  /**
   * 注入 LLM 与技能提示词提供器，并初始化消息处理链路。
   * 这一步完成后，网关收到消息时才能继续路由到 Chat/Cowork 层。
   */
  initialize(options: { getLLMConfig: () => Promise<any>; getSkillsPrompt?: () => Promise<string | null> }): void {
    this.getLLMConfig = options.getLLMConfig
    this.getSkillsPrompt = options.getSkillsPrompt ?? null

    // 初始化统一消息处理器，并挂到每个平台网关上。
    this.setupMessageHandlers()
  }

  /**
   * 为所有平台注册统一的消息处理入口。
   * 收到消息后会先持久化通知目标，再优先走 Cowork，最后才回退到普通聊天。
   */
  private setupMessageHandlers(): void {
    const messageHandler = async (message: IMMessage, replyFn: (text: string) => Promise<void>): Promise<void> => {
      // 每次收到消息都记住“从哪里回消息”，这样主动通知也能发回正确会话。
      this.persistNotificationTarget(message.platform)

      try {
        let response: string

        // 只要 Cowork 处理器可用，就优先走带工具能力的会话模式。
        if (this.coworkHandler) {
          console.log('[IMGatewayManager] Using Cowork mode for message processing')
          response = await this.coworkHandler.processMessage(message)
        } else {
          // Cowork 不可用时，回退到普通聊天处理器。
          if (!this.chatHandler) {
            this.updateChatHandler()
          }

          if (!this.chatHandler) {
            throw new Error('Chat handler not available')
          }

          response = await this.chatHandler.processMessage(message)
        }

        await replyFn(response)
      } catch (error: any) {
        console.error(`[IMGatewayManager] Error processing message: ${error.message}`)
        // “被更新请求替代”属于内部控制流，不向用户回显错误。
        if (error.message === 'Replaced by a newer IM request') {
          return
        }
        // 其它异常则尽量通过原会话回一条失败说明。
        try {
          await replyFn(`处理消息时出错: ${error.message}`)
        } catch (replyError) {
          console.error(`[IMGatewayManager] Failed to send error reply: ${replyError}`)
        }
      }
    }

    this.dingtalkGateway.setMessageCallback(messageHandler)
    this.feishuGateway.setMessageCallback(messageHandler)
    this.telegramGateway.setMessageCallback(messageHandler)
    this.discordGateway.setMessageCallback(messageHandler)
    this.nimGateway.setMessageCallback(messageHandler)
    this.xiaomifengGateway.setMessageCallback(messageHandler)
    this.qqGateway.setMessageCallback(messageHandler)
    this.wecomGateway.setMessageCallback(messageHandler)
  }

  /**
   * 在收到消息后持久化当前平台的通知目标。
   * 这样即使应用重启，也能知道后续通知应发到哪个会话/频道。
   */
  private persistNotificationTarget(platform: IMPlatform): void {
    try {
      let target: any = null
      if (platform === 'dingtalk') {
        target = this.dingtalkGateway.getNotificationTarget()
      } else if (platform === 'feishu') {
        target = this.feishuGateway.getNotificationTarget()
      } else if (platform === 'telegram') {
        target = this.telegramGateway.getNotificationTarget()
      } else if (platform === 'discord') {
        target = this.discordGateway.getNotificationTarget()
      } else if (platform === 'nim') {
        target = this.nimGateway.getNotificationTarget()
      } else if (platform === 'qq') {
        target = this.qqGateway.getNotificationTarget()
      } else if (platform === 'wecom') {
        target = this.wecomGateway.getNotificationTarget()
      }
      if (target != null) {
        this.imStore.setNotificationTarget(platform, target)
      }
    } catch (err: any) {
      console.warn(`[IMGatewayManager] Failed to persist notification target for ${platform}:`, err.message)
    }
  }

  /**
   * 在网关启动后恢复上一次的通知目标。
   * 主要用于让“主动通知”在重启后仍能继续发回原目标。
   */
  private restoreNotificationTarget(platform: IMPlatform): void {
    try {
      const target = this.imStore.getNotificationTarget(platform)
      if (target == null) return

      if (platform === 'dingtalk') {
        this.dingtalkGateway.setNotificationTarget(target)
      } else if (platform === 'feishu') {
        this.feishuGateway.setNotificationTarget(target)
      } else if (platform === 'telegram') {
        this.telegramGateway.setNotificationTarget(target)
      } else if (platform === 'discord') {
        this.discordGateway.setNotificationTarget(target)
      } else if (platform === 'nim') {
        this.nimGateway.setNotificationTarget(target)
      } else if (platform === 'qq') {
        this.qqGateway.setNotificationTarget(target)
      } else if (platform === 'wecom') {
        this.wecomGateway.setNotificationTarget(target)
      }
      console.log(`[IMGatewayManager] Restored notification target for ${platform}`)
    } catch (err: any) {
      console.warn(`[IMGatewayManager] Failed to restore notification target for ${platform}:`, err.message)
    }
  }

  /**
   * 根据当前 IM 配置刷新普通聊天处理器。
   * 当 settings 变化时，需要重新创建处理器以加载最新策略。
   */
  private updateChatHandler(): void {
    if (!this.getLLMConfig) {
      console.warn('[IMGatewayManager] LLM config provider not set')
      return
    }

    const imSettings = this.imStore.getIMSettings()

    this.chatHandler = new IMChatHandler({
      getLLMConfig: this.getLLMConfig,
      getSkillsPrompt: this.getSkillsPrompt || undefined,
      imSettings
    })

    // 普通聊天处理器准备好后，再补齐 Cowork 处理器。
    this.updateCoworkHandler()
  }

  /**
   * 创建或补齐 Cowork 处理器。
   * 只要依赖可用，这里就会启用 IM -> Cowork 的消息路由。
   */
  private updateCoworkHandler(): void {
    // Cowork 处理器只需创建一次，之后持续复用。
    if (this.coworkRunner && this.coworkStore && !this.coworkHandler) {
      this.coworkHandler = new IMCoworkHandler({
        coworkRunner: this.coworkRunner,
        coworkStore: this.coworkStore,
        imStore: this.imStore,
        getSkillsPrompt: this.getSkillsPrompt || undefined
      })
      console.log('[IMGatewayManager] Cowork handler created')
    }
  }

  // ==================== Configuration ====================

  /**
   * 读取当前完整配置。
   * 返回值已经包含默认值合并后的最终配置。
   */
  getConfig(): IMGatewayConfig {
    return this.imStore.getConfig()
  }

  /**
   * 更新配置并按需做热更新。
   * 除了写入存储，还会根据不同平台的凭据变化决定是否重启网关。
   */
  setConfig(config: Partial<IMGatewayConfig>): void {
    const previousConfig = this.imStore.getConfig()
    this.imStore.setConfig(config)

    // 全局 settings 变化后，聊天处理器的行为也可能变化，需要同步刷新。
    if (config.settings) {
      this.updateChatHandler()
    }

    // Telegram 网关运行时热更新：配置变更后按需重启
    if (config.telegram && this.telegramGateway) {
      const oldTg = previousConfig.telegram
      const newTg = { ...oldTg, ...config.telegram }
      const credentialsChanged = newTg.botToken !== oldTg.botToken
      const gatewayShouldBeActive = Boolean(newTg.enabled && newTg.botToken)

      this.telegramGateway.updateConfig(config.telegram)

      if (credentialsChanged && gatewayShouldBeActive) {
        if (this.telegramGateway.isRunning()) {
          console.log('[IMGatewayManager] Telegram credentials changed, restarting gateway...')
          this.restartGateway('telegram').catch((err) => {
            console.error('[IMGatewayManager] Failed to restart Telegram after config change:', err.message)
          })
        } else {
          console.log('[IMGatewayManager] Telegram credentials changed, starting gateway...')
          this.startGateway('telegram').catch((err) => {
            console.error('[IMGatewayManager] Failed to start Telegram after config change:', err.message)
          })
        }
      }
    }

    // NIM 网关热更新：若已连接时凭据字段变化，
    // 则无感重启网关，让 SDK 用新凭据重新登录。
    if (config.nim && this.nimGateway) {
      const oldNim = previousConfig.nim
      const newNim = { ...oldNim, ...config.nim }
      const credentialsChanged = newNim.appKey !== oldNim.appKey || newNim.account !== oldNim.account || newNim.token !== oldNim.token
      const gatewayShouldBeActive = Boolean(newNim.enabled && newNim.appKey && newNim.account && newNim.token)

      if (credentialsChanged && gatewayShouldBeActive) {
        if (this.nimGateway.isRunning() || this.nimGateway.isReconnecting()) {
          console.log('[IMGatewayManager] NIM credentials changed, restarting gateway...')
          this.restartGateway('nim').catch((err) => {
            console.error('[IMGatewayManager] Failed to restart NIM after config change:', err.message)
          })
        } else {
          console.log('[IMGatewayManager] NIM credentials changed, starting gateway...')
          this.startGateway('nim').catch((err) => {
            console.error('[IMGatewayManager] Failed to start NIM after config change:', err.message)
          })
        }
      } else {
        // 非凭据字段（如 accountWhitelist）可直接热更新，无需重启
        const nonCredentialChanged = newNim.accountWhitelist !== oldNim.accountWhitelist
        if (nonCredentialChanged) {
          console.log('[IMGatewayManager] NIM non-credential config changed, hot-updating...')
          this.nimGateway.updateConfig(config.nim)
        }
      }
    }

    // 钉钉网关热更新：凭据字段变化时重启
    if (config.dingtalk && this.dingtalkGateway) {
      const oldDt = previousConfig.dingtalk
      const newDt = { ...oldDt, ...config.dingtalk }
      const credentialsChanged = newDt.clientId !== oldDt.clientId || newDt.clientSecret !== oldDt.clientSecret
      const gatewayShouldBeActive = Boolean(newDt.enabled && newDt.clientId && newDt.clientSecret)

      if (credentialsChanged && gatewayShouldBeActive) {
        if (this.dingtalkGateway.isRunning() || this.dingtalkGateway.isReconnectingNow()) {
          console.log('[IMGatewayManager] DingTalk credentials changed, restarting gateway...')
          this.restartGateway('dingtalk').catch((err) => {
            console.error('[IMGatewayManager] Failed to restart DingTalk after config change:', err.message)
          })
        } else {
          console.log('[IMGatewayManager] DingTalk credentials changed, starting gateway...')
          this.startGateway('dingtalk').catch((err) => {
            console.error('[IMGatewayManager] Failed to start DingTalk after config change:', err.message)
          })
        }
      }
    }

    // 飞书网关热更新：凭据字段变化时重启
    if (config.feishu && this.feishuGateway) {
      const oldFs = previousConfig.feishu
      const newFs = { ...oldFs, ...config.feishu }
      const credentialsChanged = newFs.appId !== oldFs.appId || newFs.appSecret !== oldFs.appSecret
      const gatewayShouldBeActive = Boolean(newFs.enabled && newFs.appId && newFs.appSecret)

      if (credentialsChanged && gatewayShouldBeActive) {
        if (this.feishuGateway.isRunning()) {
          console.log('[IMGatewayManager] Feishu credentials changed, restarting gateway...')
          this.restartGateway('feishu').catch((err) => {
            console.error('[IMGatewayManager] Failed to restart Feishu after config change:', err.message)
          })
        } else {
          console.log('[IMGatewayManager] Feishu credentials changed, starting gateway...')
          this.startGateway('feishu').catch((err) => {
            console.error('[IMGatewayManager] Failed to start Feishu after config change:', err.message)
          })
        }
      }
    }

    // Discord 网关热更新：凭据字段变化时重启
    if (config.discord && this.discordGateway) {
      const oldDc = previousConfig.discord
      const newDc = { ...oldDc, ...config.discord }
      const credentialsChanged = newDc.botToken !== oldDc.botToken
      const gatewayShouldBeActive = Boolean(newDc.enabled && newDc.botToken)

      if (credentialsChanged && gatewayShouldBeActive) {
        if (this.discordGateway.isRunning()) {
          console.log('[IMGatewayManager] Discord credentials changed, restarting gateway...')
          this.restartGateway('discord').catch((err) => {
            console.error('[IMGatewayManager] Failed to restart Discord after config change:', err.message)
          })
        } else {
          console.log('[IMGatewayManager] Discord credentials changed, starting gateway...')
          this.startGateway('discord').catch((err) => {
            console.error('[IMGatewayManager] Failed to start Discord after config change:', err.message)
          })
        }
      }
    }

    // 小蜜蜂网关热更新：凭据字段变化时重启
    if (config.xiaomifeng && this.xiaomifengGateway) {
      const oldXmf = previousConfig.xiaomifeng
      const newXmf = { ...oldXmf, ...config.xiaomifeng }
      const credentialsChanged = newXmf.clientId !== oldXmf.clientId || newXmf.secret !== oldXmf.secret
      const gatewayShouldBeActive = Boolean(newXmf.enabled && newXmf.clientId && newXmf.secret)

      // 判断网关是否已连接或正在重连（存在待执行的重连定时器）
      const isActiveOrReconnecting = this.xiaomifengGateway.isRunning() || this.xiaomifengGateway.isReconnecting()
      if (credentialsChanged && gatewayShouldBeActive) {
        if (isActiveOrReconnecting) {
          console.log('[IMGatewayManager] Xiaomifeng credentials changed, restarting gateway...')
          this.restartGateway('xiaomifeng').catch((err) => {
            console.error('[IMGatewayManager] Failed to restart Xiaomifeng after config change:', err.message)
          })
        } else {
          console.log('[IMGatewayManager] Xiaomifeng credentials changed, starting gateway...')
          this.startGateway('xiaomifeng').catch((err) => {
            console.error('[IMGatewayManager] Failed to start Xiaomifeng after config change:', err.message)
          })
        }
      }
    }

    // QQ 网关热更新：凭据字段变化时重启
    if (config.qq && this.qqGateway) {
      const oldQQ = previousConfig.qq
      const newQQ = { ...oldQQ, ...config.qq }
      const credentialsChanged = newQQ.appId !== oldQQ.appId || newQQ.appSecret !== oldQQ.appSecret
      const gatewayShouldBeActive = Boolean(newQQ.enabled && newQQ.appId && newQQ.appSecret)

      if (credentialsChanged && gatewayShouldBeActive) {
        if (this.qqGateway.isRunning()) {
          console.log('[IMGatewayManager] QQ credentials changed, restarting gateway...')
          this.restartGateway('qq').catch((err) => {
            console.error('[IMGatewayManager] Failed to restart QQ after config change:', err.message)
          })
        } else {
          console.log('[IMGatewayManager] QQ credentials changed, starting gateway...')
          this.startGateway('qq').catch((err) => {
            console.error('[IMGatewayManager] Failed to start QQ after config change:', err.message)
          })
        }
      }
    }

    // 企业微信网关热更新：凭据字段变化时重启
    if (config.wecom && this.wecomGateway) {
      const oldWc = previousConfig.wecom
      const newWc = { ...oldWc, ...config.wecom }
      const credentialsChanged = newWc.botId !== oldWc.botId || newWc.secret !== oldWc.secret
      const gatewayShouldBeActive = Boolean(newWc.enabled && newWc.botId && newWc.secret)

      if (credentialsChanged && gatewayShouldBeActive) {
        if (this.wecomGateway.isRunning()) {
          console.log('[IMGatewayManager] WeCom credentials changed, restarting gateway...')
          this.restartGateway('wecom').catch((err) => {
            console.error('[IMGatewayManager] Failed to restart WeCom after config change:', err.message)
          })
        } else {
          console.log('[IMGatewayManager] WeCom credentials changed, starting gateway...')
          this.startGateway('wecom').catch((err) => {
            console.error('[IMGatewayManager] Failed to start WeCom after config change:', err.message)
          })
        }
      }
    }
  }

  /**
   * 重启指定网关。
   * 主要用于运行中凭据变化后的热重载。
   */
  private async restartGateway(platform: IMPlatform): Promise<void> {
    console.log(`[IMGatewayManager] Restarting ${platform} gateway...`)
    await this.stopGateway(platform)
    await this.startGateway(platform)
    console.log(`[IMGatewayManager] ${platform} gateway restarted successfully`)
  }

  // ==================== Status ====================

  /**
   * 汇总所有平台的当前状态快照。
   */
  getStatus(): IMGatewayStatus {
    return {
      dingtalk: this.dingtalkGateway.getStatus(),
      feishu: this.feishuGateway.getStatus(),
      qq: this.qqGateway.getStatus(),
      telegram: this.telegramGateway.getStatus(),
      discord: this.discordGateway.getStatus(),
      nim: this.nimGateway.getStatus(),
      xiaomifeng: this.xiaomifengGateway.getStatus(),
      wecom: this.wecomGateway.getStatus()
    }
  }

  /**
   * 测试指定平台的连通性与对话就绪度。
   * 结果不只是“鉴权是否通过”，还会补充网关运行态、收发消息活跃度、
   * 最近错误和平台特有提示，最终汇总成 verdict。
   */
  async testGateway(platform: IMPlatform, configOverride?: Partial<IMGatewayConfig>): Promise<IMConnectivityTestResult> {
    const config = this.buildMergedConfig(configOverride)
    const checks: IMConnectivityCheck[] = []
    const testedAt = Date.now()

    // 统一追加检查项，保证最终结果按生成顺序展示。
    const addCheck = (check: IMConnectivityCheck) => {
      checks.push(check)
    }

    const missingCredentials = this.getMissingCredentials(platform, config)
    if (missingCredentials.length > 0) {
      addCheck({
        code: 'missing_credentials',
        level: 'fail',
        message: `缺少必要配置项: ${missingCredentials.join(', ')}`,
        suggestion: '请补全配置后重新测试连通性。'
      })

      return {
        platform,
        testedAt,
        verdict: 'fail',
        checks
      }
    }

    try {
      const authMessage = await this.withTimeout(this.runAuthProbe(platform, config), CONNECTIVITY_TIMEOUT_MS, '鉴权探测超时')
      addCheck({
        code: 'auth_check',
        level: 'pass',
        message: authMessage
      })
    } catch (error: any) {
      addCheck({
        code: 'auth_check',
        level: 'fail',
        message: `鉴权失败: ${error.message}`,
        suggestion: '请检查 ID/Secret/Token 是否正确，且机器人权限已开通。'
      })
      return {
        platform,
        testedAt,
        verdict: 'fail',
        checks
      }
    }

    const status = this.getStatus()
    const enabled = Boolean(config[platform]?.enabled)
    const connected = this.isConnected(platform)

    if (enabled && !connected) {
      const discordStarting = platform === 'discord' && status.discord.starting
      addCheck({
        code: 'gateway_running',
        level: discordStarting ? 'info' : 'warn',
        message: discordStarting ? 'IM 渠道正在启动，请稍后重试。' : 'IM 渠道已启用但当前未连接。',
        suggestion: discordStarting ? '等待启动完成后重新测试。' : '请检查网络、机器人配置和平台侧事件开关。'
      })
    } else {
      addCheck({
        code: 'gateway_running',
        level: connected ? 'pass' : 'info',
        message: connected ? 'IM 渠道已启用且运行正常。' : 'IM 渠道当前未启用。',
        suggestion: connected ? undefined : '请点击对应 IM 渠道胶囊按钮启用该渠道。'
      })
    }

    const startedAt = this.getStartedAtMs(platform, status)
    const lastInboundAt = this.getLastInboundAt(platform, status)
    const lastOutboundAt = this.getLastOutboundAt(platform, status)

    if (connected && startedAt && testedAt - startedAt >= INBOUND_ACTIVITY_WARN_AFTER_MS) {
      if (!lastInboundAt) {
        addCheck({
          code: 'inbound_activity',
          level: 'warn',
          message: '已连接超过 2 分钟，但尚未收到任何入站消息。',
          suggestion: '请确认机器人已在目标会话中，或按平台规则 @机器人 触发消息。'
        })
      } else {
        addCheck({
          code: 'inbound_activity',
          level: 'pass',
          message: '已检测到入站消息。'
        })
      }
    } else if (connected) {
      addCheck({
        code: 'inbound_activity',
        level: 'info',
        message: '网关刚启动，入站活动检查将在 2 分钟后更准确。'
      })
    }

    if (connected && lastInboundAt) {
      if (!lastOutboundAt) {
        addCheck({
          code: 'outbound_activity',
          level: 'warn',
          message: '已收到消息，但尚未观察到成功回发。',
          suggestion: '请检查消息发送权限、机器人可见范围和会话回包权限。'
        })
      } else {
        addCheck({
          code: 'outbound_activity',
          level: 'pass',
          message: '已检测到成功回发消息。'
        })
      }
    } else if (connected) {
      addCheck({
        code: 'outbound_activity',
        level: 'info',
        message: '尚未收到可用于评估回发能力的入站消息。'
      })
    }

    const lastError = this.getLastError(platform, status)
    if (lastError) {
      addCheck({
        code: 'platform_last_error',
        level: connected ? 'warn' : 'fail',
        message: `最近错误: ${lastError}`,
        suggestion: connected ? '当前已连接，但建议修复该错误避免后续中断。' : '该错误可能阻断对话，请优先修复后重试。'
      })
    }

    if (platform === 'feishu') {
      addCheck({
        code: 'feishu_group_requires_mention',
        level: 'info',
        message: '飞书群聊中仅响应 @机器人的消息。',
        suggestion: '请在群聊中使用 @机器人 + 内容触发对话。'
      })
      addCheck({
        code: 'feishu_event_subscription_required',
        level: 'info',
        message: '飞书需要开启消息事件订阅（im.message.receive_v1）才能收消息。',
        suggestion: '请在飞书开发者后台确认事件订阅、权限和发布状态。'
      })
    } else if (platform === 'discord') {
      addCheck({
        code: 'discord_group_requires_mention',
        level: 'info',
        message: 'Discord 群聊中仅响应 @机器人的消息。',
        suggestion: '请在频道中使用 @机器人 + 内容触发对话。'
      })
    } else if (platform === 'telegram') {
      addCheck({
        code: 'telegram_privacy_mode_hint',
        level: 'info',
        message: 'Telegram 群聊中仅响应 @机器人 或回复机器人的消息。',
        suggestion: '请先在 @BotFather 中关闭 Privacy Mode（/setprivacy → Disable），然后在群聊中使用 @机器人 + 内容触发对话。'
      })
    } else if (platform === 'dingtalk') {
      addCheck({
        code: 'dingtalk_bot_membership_hint',
        level: 'info',
        message: '钉钉机器人需被加入目标会话并具备发言权限。',
        suggestion: '请确认机器人在目标会话中，且企业权限配置允许收发消息。'
      })
    } else if (platform === 'nim') {
      addCheck({
        code: 'nim_p2p_only_hint',
        level: 'info',
        message: '云信 IM 当前仅支持 P2P（私聊）消息。',
        suggestion: '请通过私聊方式向机器人账号发送消息触发对话。'
      })
    } else if (platform === 'qq') {
      addCheck({
        code: 'qq_guild_mention_hint',
        level: 'info',
        message: 'QQ 频道中需要 @机器人 才能触发消息响应，也支持私信对话。',
        suggestion: '请在频道中使用 @机器人 + 内容触发对话，或通过私信直接发送消息。'
      })
    } else if (platform === 'wecom') {
      addCheck({
        code: 'nim_p2p_only_hint',
        level: 'info',
        message: '企业微信机器人通过 WebSocket 长连接接收消息。',
        suggestion: '请在企业微信中向机器人发送消息触发对话。群聊中需 @机器人。'
      })
    }

    return {
      platform,
      testedAt,
      verdict: this.calculateVerdict(checks),
      checks
    }
  }

  // ==================== Gateway Control ====================

  /**
   * 启动指定平台网关。
   * 启动前会确保消息处理器已就绪，启动后会恢复通知目标。
   */
  async startGateway(platform: IMPlatform): Promise<void> {
    const config = this.getConfig()

    // 网关开始收消息前，先保证上游处理器已经准备好。
    this.updateChatHandler()

    if (platform === 'dingtalk') {
      await this.dingtalkGateway.start(config.dingtalk)
    } else if (platform === 'feishu') {
      await this.feishuGateway.start(config.feishu)
    } else if (platform === 'telegram') {
      await this.telegramGateway.start(config.telegram)
    } else if (platform === 'discord') {
      await this.discordGateway.start(config.discord)
    } else if (platform === 'nim') {
      await this.nimGateway.start(config.nim)
    } else if (platform === 'xiaomifeng') {
      await this.xiaomifengGateway.start(config.xiaomifeng)
    } else if (platform === 'qq') {
      await this.qqGateway.start(config.qq)
    } else if (platform === 'wecom') {
      await this.wecomGateway.start(config.wecom)
    }

    // 启动后恢复此前记住的通知目标。
    this.restoreNotificationTarget(platform)
  }

  /**
   * 停止指定平台网关。
   */
  async stopGateway(platform: IMPlatform): Promise<void> {
    if (platform === 'dingtalk') {
      await this.dingtalkGateway.stop()
    } else if (platform === 'feishu') {
      await this.feishuGateway.stop()
    } else if (platform === 'telegram') {
      await this.telegramGateway.stop()
    } else if (platform === 'discord') {
      await this.discordGateway.stop()
    } else if (platform === 'nim') {
      await this.nimGateway.stop()
    } else if (platform === 'xiaomifeng') {
      await this.xiaomifengGateway.stop()
    } else if (platform === 'qq') {
      await this.qqGateway.stop()
    } else if (platform === 'wecom') {
      await this.wecomGateway.stop()
    }
  }

  /**
   * 启动所有“已启用且配置完整”的平台。
   * 每个平台独立 try/catch，保证局部失败不会阻断其它网关。
   */
  async startAllEnabled(): Promise<void> {
    const config = this.getConfig()

    if (config.dingtalk.enabled && config.dingtalk.clientId && config.dingtalk.clientSecret) {
      try {
        await this.startGateway('dingtalk')
      } catch (error: any) {
        console.error(`[IMGatewayManager] Failed to start DingTalk: ${error.message}`)
      }
    }

    if (config.feishu.enabled && config.feishu.appId && config.feishu.appSecret) {
      try {
        await this.startGateway('feishu')
      } catch (error: any) {
        console.error(`[IMGatewayManager] Failed to start Feishu: ${error.message}`)
      }
    }

    if (config.telegram.enabled && config.telegram.botToken) {
      try {
        await this.startGateway('telegram')
      } catch (error: any) {
        console.error(`[IMGatewayManager] Failed to start Telegram: ${error.message}`)
      }
    }

    if (config.discord.enabled && config.discord.botToken) {
      try {
        await this.startGateway('discord')
      } catch (error: any) {
        console.error(`[IMGatewayManager] Failed to start Discord: ${error.message}`)
      }
    }

    if (config.nim.enabled && config.nim.appKey && config.nim.account && config.nim.token) {
      try {
        await this.startGateway('nim')
      } catch (error: any) {
        console.error(`[IMGatewayManager] Failed to start NIM: ${error.message}`)
      }
    }

    if (config.xiaomifeng?.enabled && config.xiaomifeng?.clientId && config.xiaomifeng?.secret) {
      try {
        await this.startGateway('xiaomifeng')
      } catch (error: any) {
        console.error(`[IMGatewayManager] Failed to start Xiaomifeng: ${error.message}`)
      }
    }

    if (config.qq?.enabled && config.qq?.appId && config.qq?.appSecret) {
      try {
        await this.startGateway('qq')
      } catch (error: any) {
        console.error(`[IMGatewayManager] Failed to start QQ: ${error.message}`)
      }
    }

    if (config.wecom?.enabled && config.wecom?.botId && config.wecom?.secret) {
      try {
        await this.startGateway('wecom')
      } catch (error: any) {
        console.error(`[IMGatewayManager] Failed to start WeCom: ${error.message}`)
      }
    }
  }

  /**
   * 停止所有平台网关。
   */
  async stopAll(): Promise<void> {
    await Promise.all([
      this.dingtalkGateway.stop(),
      this.feishuGateway.stop(),
      this.telegramGateway.stop(),
      this.discordGateway.stop(),
      this.nimGateway.stop(),
      this.xiaomifengGateway.stop(),
      this.qqGateway.stop(),
      this.wecomGateway.stop()
    ])
  }

  /**
   * 判断当前是否至少有一个平台处于已连接状态。
   */
  isAnyConnected(): boolean {
    return (
      this.dingtalkGateway.isConnected() ||
      this.feishuGateway.isConnected() ||
      this.telegramGateway.isConnected() ||
      this.discordGateway.isConnected() ||
      this.nimGateway.isConnected() ||
      this.xiaomifengGateway.isConnected() ||
      this.qqGateway.isConnected() ||
      this.wecomGateway.isConnected()
    )
  }

  /**
   * 判断指定平台当前是否已连接。
   */
  isConnected(platform: IMPlatform): boolean {
    if (platform === 'dingtalk') {
      return this.dingtalkGateway.isConnected()
    }
    if (platform === 'telegram') {
      return this.telegramGateway.isConnected()
    }
    if (platform === 'discord') {
      return this.discordGateway.isConnected()
    }
    if (platform === 'nim') {
      return this.nimGateway.isConnected()
    }
    if (platform === 'xiaomifeng') {
      return this.xiaomifengGateway.isConnected()
    }
    if (platform === 'qq') {
      return this.qqGateway.isConnected()
    }
    if (platform === 'wecom') {
      return this.wecomGateway.isConnected()
    }
    return this.feishuGateway.isConnected()
  }

  /**
   * 通过指定平台发送纯文本通知。
   * 这里走各平台自己的广播/通知发送机制，而不是普通会话回复链路。
   */
  async sendNotification(platform: IMPlatform, text: string): Promise<boolean> {
    if (!this.isConnected(platform)) {
      console.warn(`[IMGatewayManager] Cannot send notification: ${platform} is not connected`)
      return false
    }

    try {
      if (platform === 'dingtalk') {
        await this.dingtalkGateway.sendNotification(text)
      } else if (platform === 'feishu') {
        await this.feishuGateway.sendNotification(text)
      } else if (platform === 'telegram') {
        await this.telegramGateway.sendNotification(text)
      } else if (platform === 'discord') {
        await this.discordGateway.sendNotification(text)
      } else if (platform === 'nim') {
        await this.nimGateway.sendNotification(text)
      } else if (platform === 'qq') {
        await this.qqGateway.sendNotification(text)
      } else if (platform === 'wecom') {
        await this.wecomGateway.sendNotification(text)
      } else if (platform === 'xiaomifeng') {
        await this.xiaomifengGateway.sendNotification(text)
      }
      return true
    } catch (error: any) {
      console.error(`[IMGatewayManager] Failed to send notification via ${platform}:`, error.message)
      return false
    }
  }

  /**
   * 通过指定平台发送带媒体能力的通知。
   * 具体“媒体”形态由各平台网关内部决定。
   */
  async sendNotificationWithMedia(platform: IMPlatform, text: string): Promise<boolean> {
    if (!this.isConnected(platform)) {
      console.warn(`[IMGatewayManager] Cannot send notification: ${platform} is not connected`)
      return false
    }

    try {
      if (platform === 'dingtalk') {
        await this.dingtalkGateway.sendNotificationWithMedia(text)
      } else if (platform === 'feishu') {
        await this.feishuGateway.sendNotificationWithMedia(text)
      } else if (platform === 'telegram') {
        await this.telegramGateway.sendNotificationWithMedia(text)
      } else if (platform === 'discord') {
        await this.discordGateway.sendNotificationWithMedia(text)
      } else if (platform === 'nim') {
        await this.nimGateway.sendNotificationWithMedia(text)
      } else if (platform === 'qq') {
        await this.qqGateway.sendNotificationWithMedia(text)
      } else if (platform === 'wecom') {
        await this.wecomGateway.sendNotificationWithMedia(text)
      } else if (platform === 'xiaomifeng') {
        await this.xiaomifengGateway.sendNotificationWithMedia(text)
      }
      return true
    } catch (error: any) {
      console.error(`[IMGatewayManager] Failed to send notification with media via ${platform}:`, error.message)
      return false
    }
  }

  /**
   * 将外部传入的临时配置覆盖到当前配置上，生成测试/启动时使用的最终配置。
   */
  private buildMergedConfig(configOverride?: Partial<IMGatewayConfig>): IMGatewayConfig {
    const current = this.getConfig()
    if (!configOverride) {
      return current
    }
    return {
      ...current,
      ...configOverride,
      dingtalk: { ...current.dingtalk, ...(configOverride.dingtalk || {}) },
      feishu: { ...current.feishu, ...(configOverride.feishu || {}) },
      qq: { ...current.qq, ...(configOverride.qq || {}) },
      telegram: { ...current.telegram, ...(configOverride.telegram || {}) },
      discord: { ...current.discord, ...(configOverride.discord || {}) },
      nim: { ...current.nim, ...(configOverride.nim || {}) },
      xiaomifeng: { ...current.xiaomifeng, ...(configOverride.xiaomifeng || {}) },
      wecom: { ...current.wecom, ...(configOverride.wecom || {}) },
      settings: { ...current.settings, ...(configOverride.settings || {}) }
    }
  }

  /**
   * 检查指定平台缺少哪些必填凭据字段。
   * 用于在真正发起鉴权前，先给出更直观的失败原因。
   */
  private getMissingCredentials(platform: IMPlatform, config: IMGatewayConfig): string[] {
    if (platform === 'dingtalk') {
      const fields: string[] = []
      if (!config.dingtalk.clientId) fields.push('clientId')
      if (!config.dingtalk.clientSecret) fields.push('clientSecret')
      return fields
    }
    if (platform === 'feishu') {
      const fields: string[] = []
      if (!config.feishu.appId) fields.push('appId')
      if (!config.feishu.appSecret) fields.push('appSecret')
      return fields
    }
    if (platform === 'telegram') {
      return config.telegram.botToken ? [] : ['botToken']
    }
    if (platform === 'nim') {
      const fields: string[] = []
      if (!config.nim.appKey) fields.push('appKey')
      if (!config.nim.account) fields.push('account')
      if (!config.nim.token) fields.push('token')
      return fields
    }
    if (platform === 'xiaomifeng') {
      const fields: string[] = []
      if (!config.xiaomifeng?.clientId) fields.push('clientId')
      if (!config.xiaomifeng?.secret) fields.push('secret')
      return fields
    }
    if (platform === 'qq') {
      const fields: string[] = []
      if (!config.qq?.appId) fields.push('appId')
      if (!config.qq?.appSecret) fields.push('appSecret')
      return fields
    }
    if (platform === 'wecom') {
      const fields: string[] = []
      if (!config.wecom?.botId) fields.push('botId')
      if (!config.wecom?.secret) fields.push('secret')
      return fields
    }
    return config.discord.botToken ? [] : ['botToken']
  }

  /**
   * 执行平台特定的鉴权探测。
   * 这里关注的是“凭据是否有效、平台接口是否可达”，不直接代表消息链路完全可用。
   */
  private async runAuthProbe(platform: IMPlatform, config: IMGatewayConfig): Promise<string> {
    if (platform === 'dingtalk') {
      await getOapiAccessToken(config.dingtalk.clientId, config.dingtalk.clientSecret)
      return '钉钉鉴权通过。'
    }

    if (platform === 'feishu') {
      const Lark = await import('@larksuiteoapi/node-sdk')
      const domain = this.resolveFeishuDomain(config.feishu.domain, Lark)
      const client = new Lark.Client({
        appId: config.feishu.appId,
        appSecret: config.feishu.appSecret,
        appType: Lark.AppType.SelfBuild,
        domain
      })
      const response: any = await client.request({
        method: 'GET',
        url: '/open-apis/bot/v3/info'
      })
      if (response.code !== 0) {
        throw new Error(response.msg || `code ${response.code}`)
      }
      const botName = response.data?.app_name ?? response.data?.bot?.app_name ?? 'unknown'
      return `飞书鉴权通过（Bot: ${botName}）。`
    }

    if (platform === 'telegram') {
      const response = await fetchJsonWithTimeout<TelegramGetMeResponse>(
        `https://api.telegram.org/bot${config.telegram.botToken}/getMe`,
        {},
        CONNECTIVITY_TIMEOUT_MS
      )
      if (!response.ok) {
        const description = response.description || 'unknown error'
        throw new Error(description)
      }
      const username = response.result?.username ? `@${response.result.username}` : 'unknown'
      return `Telegram 鉴权通过（Bot: ${username}）。`
    }
    if (platform === 'nim') {
      // 使用隔离的临时 NimGateway 实例进行探测，
      // 避免污染主网关状态，也避免触发 onMessageCallback。
      await this.testNimConnectivity(config.nim)
      return `云信鉴权通过（Account: ${config.nim.account}，SDK 登录成功）。`
    }

    if (platform === 'xiaomifeng') {
      // 小蜜蜂使用网易云信 NIM SDK，鉴权是通过 SDK 登录验证的
      // 这里我们只做配置完整性检查，实际登录验证在 start 时进行
      const { clientId, secret } = config.xiaomifeng
      if (!clientId || !secret) {
        throw new Error('配置不完整')
      }
      return `小蜜蜂配置已就绪（Client ID: ${clientId}）。`
    }

    if (platform === 'wecom') {
      const { botId, secret } = config.wecom
      if (!botId || !secret) {
        throw new Error('配置不完整')
      }
      const currentWecomConfig = this.getConfig().wecom
      const matchesActiveConfig = currentWecomConfig.botId === botId && currentWecomConfig.secret === secret

      if (currentWecomConfig.enabled && matchesActiveConfig && this.wecomGateway.isRunning()) {
        await this.wecomGateway.waitForConnection(CONNECTIVITY_TIMEOUT_MS)
        return `企业微信网关已连接（Bot ID: ${botId}）。`
      }

      // 创建临时 WSClient 进行鉴权验证
      const { WSClient } = await import('@wecom/aibot-node-sdk')
      const tmpClient = new WSClient({ botId, secret, maxReconnectAttempts: 0 })
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('企业微信鉴权超时（10s）'))
          }, CONNECTIVITY_TIMEOUT_MS)
          tmpClient.on('authenticated', () => {
            clearTimeout(timer)
            resolve()
          })
          tmpClient.on('error', (err: Error) => {
            clearTimeout(timer)
            reject(err)
          })
          tmpClient.connect()
        })
        return `企业微信鉴权通过（Bot ID: ${botId}）。`
      } finally {
        try {
          tmpClient.disconnect()
        } catch (_) {
          /* ignore */
        }
      }
    }

    if (platform === 'discord') {
      const response = await fetchJsonWithTimeout<DiscordUserResponse>(
        'https://discord.com/api/v10/users/@me',
        {
          headers: {
            Authorization: `Bot ${config.discord.botToken}`
          }
        },
        CONNECTIVITY_TIMEOUT_MS
      )
      const username = response.username ? `${response.username}#${response.discriminator || '0000'}` : 'unknown'
      return `Discord 鉴权通过（Bot: ${username}）。`
    }

    if (platform === 'qq') {
      const { appId, appSecret } = config.qq
      if (!appId || !appSecret) {
        throw new Error('配置不完整')
      }
      // 通过 HTTP 直接请求 AccessToken 验证凭据
      // 避免仅为鉴权检查而启动完整 WebSocket 连接
      const tokenResponse = await fetchJsonWithTimeout<{ access_token?: string; expires_in?: number; code?: number; message?: string }>(
        'https://bots.qq.com/app/getAppAccessToken',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId, clientSecret: appSecret })
        },
        CONNECTIVITY_TIMEOUT_MS
      )
      if (!tokenResponse.access_token) {
        throw new Error(tokenResponse.message || '获取 AccessToken 失败')
      }
      return `QQ 鉴权通过（AccessToken 已获取）。`
    }

    return '未知平台。'
  }

  /**
   * 测试 NIM 连通性。
   * 由于 NIM 有单点登录限制，这里不能并行起第二个正式实例做探活，
   * 只能在互斥保护下串行地停主实例、起临时探针、再恢复主实例。
   */
  private async testNimConnectivity(nimConfig: IMGatewayConfig['nim']): Promise<void> {
    // 快速路径：主网关已连接时，可直接视为凭据有效。
    if (this.nimGateway.isConnected()) {
      return
    }

    // 若已有探针在执行，则先等待，避免并发创建多个 NIM SDK 实例。
    if (this.nimProbePromise) {
      try {
        await this.nimProbePromise
      } catch (_) {
        /* ignore previous probe errors */
      }
    }

    // 用成员变量保存当前探针 Promise，形成简易互斥锁。
    this.nimProbePromise = this.executeNimProbe(nimConfig)
    try {
      await this.nimProbePromise
    } finally {
      this.nimProbePromise = null
    }
  }

  /**
   * NIM 探针的内部执行逻辑（在互斥保护下调用）。
   */
  private async executeNimProbe(nimConfig: IMGatewayConfig['nim']): Promise<void> {
    // 探测前先停止主网关，避免互踢下线冲突。
    // 若当前未运行则为 no-op。
    try {
      await this.nimGateway.stop()
    } catch (_) {
      /* ignore */
    }

    // 等待原生 SDK 资源完全释放后再创建新实例。
    await new Promise((resolve) => setTimeout(resolve, 500))

    const NIM_TEST_TIMEOUT_MS = 9_000
    let tmpGateway: NimGateway | null = new NimGateway()

    // 使用唯一临时数据目录，避免文件锁冲突。
    const tmpDataPath = path.join(os.tmpdir(), `lobsterai-nim-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    fs.mkdirSync(tmpDataPath, { recursive: true })

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('NIM 登录超时（9s），请检查网络或凭据'))
        }, NIM_TEST_TIMEOUT_MS)

        tmpGateway!.once('connected', () => {
          clearTimeout(timer)
          resolve()
        })

        tmpGateway!.once('error', (err: Error) => {
          clearTimeout(timer)
          reject(err)
        })

        // 补充监听 loginFailed，避免某些场景不触发 error 事件
        tmpGateway!.once('loginFailed', (err: any) => {
          clearTimeout(timer)
          const desc = err?.desc || err?.message || JSON.stringify(err)
          reject(new Error(`NIM 登录失败: ${desc}`))
        })

        tmpGateway!.start({ ...nimConfig, enabled: true }, { appDataPathOverride: tmpDataPath }).catch(reject)
      })
    } finally {
      // 在执行后续动作前，确保临时实例已完全停止。
      if (tmpGateway) {
        const gw = tmpGateway
        tmpGateway = null
        try {
          await gw.stop()
        } catch (stopErr: any) {
          // 确保 uninit 失败不会向外冒泡为未捕获异常
          console.warn('[IMGatewayManager] NIM probe tmpGateway.stop() error (ignored):', stopErr?.message || stopErr)
        }
      }

      // 重启主网关前，再等待一次原生资源清理完成。
      await new Promise((resolve) => setTimeout(resolve, 500))

      // 短暂延时后清理临时数据目录。
      setTimeout(() => {
        try {
          fs.rmSync(tmpDataPath, { recursive: true, force: true })
        } catch (_) {
          /* ignore */
        }
      }, 2000)

      // 若 NIM 配置为启用状态，则重启主网关，恢复正常收消息能力。
      // 无论探测成功与否都尝试重启：即使探测失败，主网关此前也已被停止。
      if (nimConfig.enabled) {
        try {
          await this.startGateway('nim')
        } catch (err: any) {
          console.error('[IMGatewayManager] Failed to restart main NIM gateway after probe:', err.message)
        }
      }
    }
  }

  /**
   * 规范化飞书域名配置，兼容 SDK 枚举值与自定义域名。
   */
  private resolveFeishuDomain(domain: string, Lark: any): any {
    if (domain === 'lark') return Lark.Domain.Lark
    if (domain === 'feishu') return Lark.Domain.Feishu
    return domain.replace(/\/+$/, '')
  }

  /**
   * 为异步任务添加超时控制。
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutError: string): Promise<T> {
    let timeoutId: NodeJS.Timeout | null = null
    const timeoutPromise = new Promise<T>((_resolve, reject) => {
      timeoutId = setTimeout(() => reject(new Error(timeoutError)), timeoutMs)
    })
    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    })
  }

  /**
   * 获取指定平台的网关启动时间戳（毫秒）。
   */
  private getStartedAtMs(platform: IMPlatform, status: IMGatewayStatus): number | null {
    if (platform === 'feishu') {
      return status.feishu.startedAt ? Date.parse(status.feishu.startedAt) : null
    }
    if (platform === 'dingtalk') return status.dingtalk.startedAt
    if (platform === 'telegram') return status.telegram.startedAt
    if (platform === 'nim') return status.nim.startedAt
    if (platform === 'xiaomifeng') return status.xiaomifeng.startedAt
    if (platform === 'qq') return status.qq.startedAt
    if (platform === 'wecom') return status.wecom.startedAt
    return status.discord.startedAt
  }

  /**
   * 获取指定平台最近一次入站消息时间戳（毫秒）。
   */
  private getLastInboundAt(platform: IMPlatform, status: IMGatewayStatus): number | null {
    if (platform === 'dingtalk') return status.dingtalk.lastInboundAt
    if (platform === 'feishu') return status.feishu.lastInboundAt
    if (platform === 'telegram') return status.telegram.lastInboundAt
    if (platform === 'nim') return status.nim.lastInboundAt
    if (platform === 'xiaomifeng') return status.xiaomifeng.lastInboundAt
    if (platform === 'qq') return status.qq.lastInboundAt
    if (platform === 'wecom') return status.wecom.lastInboundAt
    return status.discord.lastInboundAt
  }

  /**
   * 获取指定平台最近一次出站消息时间戳（毫秒）。
   */
  private getLastOutboundAt(platform: IMPlatform, status: IMGatewayStatus): number | null {
    if (platform === 'dingtalk') return status.dingtalk.lastOutboundAt
    if (platform === 'feishu') return status.feishu.lastOutboundAt
    if (platform === 'telegram') return status.telegram.lastOutboundAt
    if (platform === 'nim') return status.nim.lastOutboundAt
    if (platform === 'xiaomifeng') return status.xiaomifeng.lastOutboundAt
    if (platform === 'qq') return status.qq.lastOutboundAt
    if (platform === 'wecom') return status.wecom.lastOutboundAt
    return status.discord.lastOutboundAt
  }

  /**
   * 获取指定平台最近一次错误信息。
   */
  private getLastError(platform: IMPlatform, status: IMGatewayStatus): string | null {
    if (platform === 'dingtalk') return status.dingtalk.lastError
    if (platform === 'feishu') return status.feishu.error
    if (platform === 'telegram') return status.telegram.lastError
    if (platform === 'nim') return status.nim.lastError
    if (platform === 'xiaomifeng') return status.xiaomifeng.lastError
    if (platform === 'qq') return status.qq.lastError
    if (platform === 'wecom') return status.wecom.lastError
    return status.discord.lastError
  }

  /**
   * 按检查项级别汇总最终连通性结论。
   */
  private calculateVerdict(checks: IMConnectivityCheck[]): IMConnectivityVerdict {
    if (checks.some((check) => check.level === 'fail')) {
      return 'fail'
    }
    if (checks.some((check) => check.level === 'warn')) {
      return 'warn'
    }
    return 'pass'
  }
}
