/**
 * 飞书/Lark 网关。
 * 负责通过 WebSocket 接收消息并回调上层处理器。
 * 基于既有 im-gateway 逻辑改造，适配 Electron 主进程场景。
 */

import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as path from 'path'
import { FeishuConfig, FeishuGatewayStatus, FeishuMessageContext, IMMessage, IMMediaAttachment, DEFAULT_FEISHU_STATUS } from './types'
import {
  uploadImageToFeishu,
  uploadFileToFeishu,
  detectFeishuFileType,
  isFeishuImagePath,
  isFeishuAudioPath,
  resolveFeishuMediaPath,
  downloadFeishuMedia,
  getFeishuDefaultMimeType,
  mapFeishuMediaType
} from './feishuMedia'
import { parseMediaMarkers } from './dingtalkMediaParser'
import { stringifyAsciiJson } from './jsonEncoding'
import { isSystemProxyEnabled, resolveSystemProxyUrl } from '../libs/systemProxy'

// 消息去重缓存
const processedMessages = new Map<string, number>()
const MESSAGE_DEDUP_TTL = 5 * 60 * 1000 // 5 分钟

// 飞书消息事件结构
interface FeishuMessageEvent {
  message: {
    message_id: string
    root_id?: string
    parent_id?: string
    chat_id: string
    chat_type: 'p2p' | 'group'
    message_type: string
    content: string
    mentions?: Array<{
      key: string
      id: { open_id?: string; user_id?: string }
      name: string
    }>
  }
  sender: {
    sender_id: {
      open_id?: string
      user_id?: string
    }
    sender_type: string
  }
}

export class FeishuGateway extends EventEmitter {
  private wsClient: any = null
  private restClient: any = null
  private config: FeishuConfig | null = null
  private status: FeishuGatewayStatus = { ...DEFAULT_FEISHU_STATUS }
  private botOpenId: string | null = null
  private onMessageCallback?: (message: IMMessage, replyFn: (text: string) => Promise<void>) => Promise<void>
  private lastChatId: string | null = null
  private log: (...args: any[]) => void = () => {}

  constructor() {
    super()
  }

  /**
   * 获取当前网关状态快照。
   */
  getStatus(): FeishuGatewayStatus {
    return { ...this.status }
  }

  /**
   * 判断网关是否已连接。
   */
  isConnected(): boolean {
    return this.status.connected
  }

  /**
   * 判断 WebSocket 网关实例是否已创建。
   */
  isRunning(): boolean {
    return this.wsClient !== null
  }

  /**
   * 对外暴露的重连入口（例如网络恢复事件触发）。
   */
  reconnectIfNeeded(): void {
    if (!this.wsClient && this.config) {
      this.log('[Feishu Gateway] External reconnection trigger')
      this.start(this.config).catch((error) => {
        console.error('[Feishu Gateway] Reconnection failed:', error.message)
      })
    }
  }

  /**
   * 设置消息处理回调。
   */
  setMessageCallback(callback: (message: IMMessage, replyFn: (text: string) => Promise<void>) => Promise<void>): void {
    this.onMessageCallback = callback
  }

  /**
   * 启动飞书网关。
   */
  async start(config: FeishuConfig): Promise<void> {
    if (this.wsClient) {
      throw new Error('Feishu gateway already running')
    }

    if (!config.enabled) {
      console.log('[Feishu Gateway] Feishu is disabled in config')
      return
    }

    if (!config.appId || !config.appSecret) {
      throw new Error('Feishu appId and appSecret are required')
    }

    this.config = config
    this.log = config.debug ? console.log.bind(console) : () => {}

    this.log('[Feishu Gateway] Starting WebSocket gateway...')

    try {
      // 动态导入 @larksuiteoapi/node-sdk
      const Lark = await import('@larksuiteoapi/node-sdk')

      // 解析域名配置
      const domain = this.resolveDomain(config.domain, Lark)

      // 创建用于发送消息的 REST 客户端
      this.restClient = new Lark.Client({
        appId: config.appId,
        appSecret: config.appSecret,
        appType: Lark.AppType.SelfBuild,
        domain
      })

      // 探测机器人信息，获取 open_id
      const probeResult = await this.probeBot()
      if (!probeResult.ok) {
        throw new Error(`Failed to probe bot: ${probeResult.error}`)
      }

      this.botOpenId = probeResult.botOpenId || null
      this.log(`[Feishu Gateway] Bot info: ${probeResult.botName} (${this.botOpenId})`)

      // 若启用系统代理，则为 WebSocket 解析代理 Agent
      let proxyAgent: any = undefined
      if (isSystemProxyEnabled()) {
        const feishuTarget = domain === Lark.Domain.Feishu ? 'https://open.feishu.cn' : 'https://open.larksuite.com'
        const proxyUrl = await resolveSystemProxyUrl(feishuTarget)
        if (proxyUrl) {
          try {
            const { HttpsProxyAgent } = require('https-proxy-agent')
            proxyAgent = new HttpsProxyAgent(proxyUrl)
            this.log(`[Feishu Gateway] Using proxy agent for WebSocket: ${proxyUrl}`)
          } catch (e: any) {
            console.warn(`[Feishu Gateway] Failed to create proxy agent: ${e.message}`)
          }
        }
      }

      // 创建 WebSocket 客户端
      this.wsClient = new Lark.WSClient({
        appId: config.appId,
        appSecret: config.appSecret,
        domain,
        loggerLevel: config.debug ? Lark.LoggerLevel.debug : Lark.LoggerLevel.info,
        agent: proxyAgent
      })

      // 创建事件分发器
      const eventDispatcher = new Lark.EventDispatcher({
        encryptKey: config.encryptKey,
        verificationToken: config.verificationToken
      })

      // 注册事件处理器
      eventDispatcher.register({
        'im.message.receive_v1': async (data: any) => {
          try {
            const event = data as FeishuMessageEvent

            // 检查是否重复消息
            if (this.isMessageProcessed(event.message.message_id)) {
              this.log(`[Feishu Gateway] Duplicate message ignored: ${event.message.message_id}`)
              return
            }

            const ctx = this.parseMessageEvent(event)
            // 异步触发且不 await，确保 Lark SDK 能立即向飞书回 ACK。
            // 实际回复通过 replyFn/sendWithMedia 发送，而不是依赖事件返回值。
            this.handleInboundMessage(ctx).catch((err) => {
              console.error(`[Feishu Gateway] Error handling message ${ctx.messageId}: ${err.message}`)
            })
          } catch (err: any) {
            console.error(`[Feishu Gateway] Error parsing message event: ${err.message}`)
          }
        },
        'im.message.message_read_v1': async () => {
          // 忽略已读回执事件
        },
        'im.chat.member.bot.added_v1': async (data: any) => {
          this.log(`[Feishu Gateway] Bot added to chat ${data.chat_id}`)
        },
        'im.chat.member.bot.deleted_v1': async (data: any) => {
          this.log(`[Feishu Gateway] Bot removed from chat ${data.chat_id}`)
        }
      })

      // 启动 WebSocket 客户端
      this.wsClient.start({ eventDispatcher })

      this.status = {
        connected: true,
        startedAt: new Date().toISOString(),
        botOpenId: this.botOpenId,
        error: null,
        lastInboundAt: null,
        lastOutboundAt: null
      }

      this.log('[Feishu Gateway] WebSocket gateway started successfully')
      this.emit('connected')
    } catch (error: any) {
      this.wsClient = null
      this.restClient = null
      this.status = {
        connected: false,
        startedAt: null,
        botOpenId: null,
        error: error.message,
        lastInboundAt: null,
        lastOutboundAt: null
      }
      this.emit('error', error)
      throw error
    }
  }

  /**
   * 停止飞书网关。
   */
  async stop(): Promise<void> {
    if (!this.wsClient) {
      this.log('[Feishu Gateway] Not running')
      return
    }

    this.log('[Feishu Gateway] Stopping WebSocket gateway...')

    this.wsClient = null
    this.restClient = null
    this.config = null
    this.status = {
      connected: false,
      startedAt: null,
      botOpenId: this.status.botOpenId,
      error: null,
      lastInboundAt: null,
      lastOutboundAt: null
    }

    this.log('[Feishu Gateway] WebSocket gateway stopped')
    this.emit('disconnected')
  }

  /**
   * 将域名配置转换为 Lark SDK 可识别的域名值。
   */
  private resolveDomain(domain: string, Lark: any): any {
    if (domain === 'lark') return Lark.Domain.Lark
    if (domain === 'feishu') return Lark.Domain.Feishu
    return domain.replace(/\/+$/, '')
  }

  /**
   * 探测机器人信息。
   */
  private async probeBot(): Promise<{
    ok: boolean
    error?: string
    botName?: string
    botOpenId?: string
  }> {
    try {
      const response: any = await this.restClient.request({
        method: 'GET',
        url: '/open-apis/bot/v3/info'
      })

      if (response.code !== 0) {
        return { ok: false, error: response.msg }
      }

      return {
        ok: true,
        botName: response.data?.app_name ?? response.data?.bot?.app_name,
        botOpenId: response.data?.open_id ?? response.data?.bot?.open_id
      }
    } catch (err: any) {
      return { ok: false, error: err.message }
    }
  }

  /**
   * 给消息添加表情回应（尽力而为，不阻塞主流程）。
   */
  private async addReaction(messageId: string, emojiType: string): Promise<void> {
    if (!this.restClient) return
    try {
      const response: any = await this.restClient.request({
        method: 'POST',
        url: `/open-apis/im/v1/messages/${messageId}/reactions`,
        data: { reaction_type: { emoji_type: emojiType } }
      })
      if (response.code !== 0) {
        this.log(`[Feishu Gateway] Failed to add reaction: ${response.msg || response.code}`)
      }
    } catch (err: any) {
      this.log(`[Feishu Gateway] Failed to add reaction: ${err.message}`)
    }
  }

  /**
   * 判断消息是否已处理过（去重）。
   */
  private isMessageProcessed(messageId: string): boolean {
    this.cleanupProcessedMessages()
    if (processedMessages.has(messageId)) {
      return true
    }
    processedMessages.set(messageId, Date.now())
    return false
  }

  /**
   * 清理缓存中过期的消息记录。
   */
  private cleanupProcessedMessages(): void {
    const now = Date.now()
    for (const [messageId, timestamp] of processedMessages) {
      if (now - timestamp > MESSAGE_DEDUP_TTL) {
        processedMessages.delete(messageId)
      }
    }
  }

  /**
   * 解析消息内容。
   */
  private parseMessageContent(content: string, messageType: string): string {
    try {
      const parsed = JSON.parse(content)
      if (messageType === 'text') {
        return parsed.text || ''
      }
      if (messageType === 'post') {
        return this.parsePostContent(content)
      }
      // 媒体类消息先返回描述文本，media key 在 parseMessageEvent 中提取
      if (messageType === 'image') return '[图片]'
      if (messageType === 'audio') return '[语音]'
      if (messageType === 'video' || messageType === 'media') return '[视频]'
      if (messageType === 'file') return parsed.file_name ? `[文件: ${parsed.file_name}]` : '[文件]'
      return content
    } catch {
      return content
    }
  }

  /**
   * 解析 post（富文本）内容。
   */
  private parsePostContent(content: string): string {
    try {
      const parsed = JSON.parse(content)
      const title = parsed.title || ''
      const contentBlocks = parsed.content || []
      let textContent = title ? `${title}\n\n` : ''

      for (const paragraph of contentBlocks) {
        if (Array.isArray(paragraph)) {
          for (const element of paragraph) {
            if (element.tag === 'text') {
              textContent += element.text || ''
            } else if (element.tag === 'a') {
              textContent += element.text || element.href || ''
            } else if (element.tag === 'at') {
              textContent += `@${element.user_name || element.user_id || ''}`
            }
          }
          textContent += '\n'
        }
      }

      return textContent.trim() || '[富文本消息]'
    } catch {
      return '[富文本消息]'
    }
  }

  /**
   * 检查消息中是否 @ 了机器人。
   */
  private checkBotMentioned(event: FeishuMessageEvent): boolean {
    const mentions = event.message.mentions ?? []
    if (mentions.length === 0) return false
    if (!this.botOpenId) return mentions.length > 0
    return mentions.some((m) => m.id.open_id === this.botOpenId)
  }

  /**
   * 从文本中移除 @机器人 片段。
   */
  private stripBotMention(text: string, mentions?: FeishuMessageEvent['message']['mentions']): string {
    if (!mentions || mentions.length === 0) return text
    let result = text
    for (const mention of mentions) {
      result = result.replace(new RegExp(`@${mention.name}\\s*`, 'g'), '').trim()
      result = result.replace(new RegExp(mention.key, 'g'), '').trim()
    }
    return result
  }

  /**
   * 解析飞书消息事件。
   */
  private parseMessageEvent(event: FeishuMessageEvent): FeishuMessageContext {
    const messageType = event.message.message_type
    const rawContent = this.parseMessageContent(event.message.content, messageType)
    const mentionedBot = this.checkBotMentioned(event)
    const content = this.stripBotMention(rawContent, event.message.mentions)

    // 针对媒体消息，从 content JSON 中提取媒体键值
    let mediaKey: string | undefined
    let mediaType: string | undefined
    let mediaFileName: string | undefined
    let mediaDuration: number | undefined

    if (['image', 'file', 'audio', 'video', 'media'].includes(messageType)) {
      try {
        const parsed = JSON.parse(event.message.content)
        mediaType = messageType

        if (messageType === 'image') {
          mediaKey = parsed.image_key
        } else {
          // 文件、音频、视频、媒体类型均使用 file_key
          mediaKey = parsed.file_key
          mediaFileName = parsed.file_name
          if (parsed.duration !== undefined) {
            mediaDuration = typeof parsed.duration === 'string' ? parseInt(parsed.duration, 10) : parsed.duration
          }
        }
      } catch {
        // 内容解析失败时，跳过媒体字段提取
      }
    }

    return {
      chatId: event.message.chat_id,
      messageId: event.message.message_id,
      senderId: event.sender.sender_id.user_id || event.sender.sender_id.open_id || '',
      senderOpenId: event.sender.sender_id.open_id || '',
      chatType: event.message.chat_type,
      mentionedBot,
      rootId: event.message.root_id,
      parentId: event.message.parent_id,
      content,
      contentType: messageType,
      mediaKey,
      mediaType,
      mediaFileName,
      mediaDuration
    }
  }

  /**
   * 推断 receive_id_type。
   */
  private resolveReceiveIdType(target: string): 'open_id' | 'user_id' | 'chat_id' {
    if (target.startsWith('ou_')) return 'open_id'
    if (target.startsWith('oc_')) return 'chat_id'
    return 'chat_id'
  }

  /**
   * 发送文本消息。
   */
  private async sendTextMessage(to: string, text: string, replyToMessageId?: string): Promise<void> {
    const receiveIdType = this.resolveReceiveIdType(to)
    const content = stringifyAsciiJson({ text })

    if (replyToMessageId) {
      const response = await this.restClient.im.message.reply({
        path: { message_id: replyToMessageId },
        data: { content, msg_type: 'text' }
      })

      if (response.code !== 0) {
        throw new Error(`Feishu reply failed: ${response.msg || `code ${response.code}`}`)
      }
      return
    }

    const response = await this.restClient.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: { receive_id: to, content, msg_type: 'text' }
    })

    if (response.code !== 0) {
      throw new Error(`Feishu send failed: ${response.msg || `code ${response.code}`}`)
    }
  }

  /**
   * 构建 Markdown 卡片内容。
   */
  private buildMarkdownCard(text: string): Record<string, unknown> {
    return {
      config: { wide_screen_mode: true },
      elements: [{ tag: 'markdown', content: text }]
    }
  }

  /**
   * 发送卡片消息。
   */
  private async sendCardMessage(to: string, text: string, replyToMessageId?: string): Promise<void> {
    const receiveIdType = this.resolveReceiveIdType(to)
    const card = this.buildMarkdownCard(text)
    const content = stringifyAsciiJson(card)

    if (replyToMessageId) {
      const response = await this.restClient.im.message.reply({
        path: { message_id: replyToMessageId },
        data: { content, msg_type: 'interactive' }
      })

      if (response.code !== 0) {
        throw new Error(`Feishu card reply failed: ${response.msg || `code ${response.code}`}`)
      }
      return
    }

    const response = await this.restClient.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: { receive_id: to, content, msg_type: 'interactive' }
    })

    if (response.code !== 0) {
      throw new Error(`Feishu card send failed: ${response.msg || `code ${response.code}`}`)
    }
  }

  /**
   * 发送消息（根据配置自动选择文本或卡片格式）。
   */
  private async sendMessage(to: string, text: string, replyToMessageId?: string): Promise<void> {
    const renderMode = this.config?.renderMode || 'text'

    this.log(
      `[Feishu Gateway] 发送文本消息:`,
      JSON.stringify({
        to,
        renderMode,
        replyToMessageId,
        textLength: text.length
      })
    )

    if (renderMode === 'card') {
      await this.sendCardMessage(to, text, replyToMessageId)
    } else {
      await this.sendTextMessage(to, text, replyToMessageId)
    }
  }

  /**
   * 发送图片消息。
   */
  private async sendImageMessage(to: string, imageKey: string, replyToMessageId?: string): Promise<void> {
    const receiveIdType = this.resolveReceiveIdType(to)
    const content = stringifyAsciiJson({ image_key: imageKey })

    this.log(
      `[Feishu Gateway] 发送图片消息:`,
      JSON.stringify({
        to,
        imageKey,
        receiveIdType,
        replyToMessageId
      })
    )

    if (replyToMessageId) {
      const response = await this.restClient.im.message.reply({
        path: { message_id: replyToMessageId },
        data: { content, msg_type: 'image' }
      })
      if (response.code !== 0) {
        throw new Error(`Feishu image reply failed: ${response.msg || `code ${response.code}`}`)
      }
      return
    }

    const response = await this.restClient.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: { receive_id: to, content, msg_type: 'image' }
    })
    if (response.code !== 0) {
      throw new Error(`Feishu image send failed: ${response.msg || `code ${response.code}`}`)
    }
  }

  /**
   * 发送文件消息。
   */
  private async sendFileMessage(to: string, fileKey: string, replyToMessageId?: string): Promise<void> {
    const receiveIdType = this.resolveReceiveIdType(to)
    const content = stringifyAsciiJson({ file_key: fileKey })

    this.log(
      `[Feishu Gateway] 发送文件消息:`,
      JSON.stringify({
        to,
        fileKey,
        receiveIdType,
        replyToMessageId
      })
    )

    if (replyToMessageId) {
      const response = await this.restClient.im.message.reply({
        path: { message_id: replyToMessageId },
        data: { content, msg_type: 'file' }
      })
      if (response.code !== 0) {
        throw new Error(`Feishu file reply failed: ${response.msg || `code ${response.code}`}`)
      }
      return
    }

    const response = await this.restClient.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: { receive_id: to, content, msg_type: 'file' }
    })
    if (response.code !== 0) {
      throw new Error(`Feishu file send failed: ${response.msg || `code ${response.code}`}`)
    }
  }

  /**
   * 发送音频消息。
   */
  private async sendAudioMessage(to: string, fileKey: string, duration?: number, replyToMessageId?: string): Promise<void> {
    const receiveIdType = this.resolveReceiveIdType(to)
    const content = stringifyAsciiJson({
      file_key: fileKey,
      ...(duration !== undefined && { duration: Math.floor(duration).toString() })
    })

    this.log(
      `[Feishu Gateway] 发送音频消息:`,
      JSON.stringify({
        to,
        fileKey,
        duration,
        receiveIdType,
        replyToMessageId
      })
    )

    if (replyToMessageId) {
      const response = await this.restClient.im.message.reply({
        path: { message_id: replyToMessageId },
        data: { content, msg_type: 'audio' }
      })
      if (response.code !== 0) {
        throw new Error(`Feishu audio reply failed: ${response.msg || `code ${response.code}`}`)
      }
      return
    }

    const response = await this.restClient.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: { receive_id: to, content, msg_type: 'audio' }
    })
    if (response.code !== 0) {
      throw new Error(`Feishu audio send failed: ${response.msg || `code ${response.code}`}`)
    }
  }

  /**
   * 根据文件路径上传媒体并发送。
   * @param customFileName - 从 Markdown 解析出的自定义文件名（如 [今日新闻](file.txt) 中的"今日新闻"）
   */
  private async uploadAndSendMedia(
    to: string,
    filePath: string,
    mediaType: 'image' | 'video' | 'audio' | 'file',
    replyToMessageId?: string,
    customFileName?: string
  ): Promise<void> {
    // 解析路径
    const absPath = resolveFeishuMediaPath(filePath)

    if (!fs.existsSync(absPath)) {
      console.warn(`[Feishu Gateway] File not found: ${absPath}`)
      return
    }

    // 使用自定义文件名或从路径提取，保留原始扩展名
    const originalFileName = path.basename(absPath)
    const ext = path.extname(absPath)
    const fileName = customFileName ? `${customFileName}${ext}` : originalFileName
    const fileStats = fs.statSync(absPath)

    this.log(
      `[Feishu Gateway] 上传媒体:`,
      JSON.stringify({
        absPath,
        mediaType,
        originalFileName,
        customFileName,
        fileName,
        fileSize: fileStats.size,
        fileSizeKB: (fileStats.size / 1024).toFixed(1)
      })
    )

    if (mediaType === 'image' || isFeishuImagePath(absPath)) {
      // 上传图片
      this.log(`[Feishu Gateway] 开始上传图片: ${fileName}`)
      const result = await uploadImageToFeishu(this.restClient, absPath)
      this.log(`[Feishu Gateway] 图片上传结果:`, JSON.stringify(result))
      if (!result.success || !result.imageKey) {
        console.warn(`[Feishu Gateway] Image upload failed: ${result.error}`)
        return
      }
      await this.sendImageMessage(to, result.imageKey, replyToMessageId)
    } else if (mediaType === 'audio' || isFeishuAudioPath(absPath)) {
      // 上传音频
      this.log(`[Feishu Gateway] 开始上传音频: ${fileName}`)
      const result = await uploadFileToFeishu(this.restClient, absPath, fileName, 'opus')
      this.log(`[Feishu Gateway] 音频上传结果:`, JSON.stringify(result))
      if (!result.success || !result.fileKey) {
        console.warn(`[Feishu Gateway] Audio upload failed: ${result.error}`)
        return
      }
      await this.sendAudioMessage(to, result.fileKey, undefined, replyToMessageId)
    } else {
      // 作为文件上传（包括视频；飞书视频需封面图，这里为简化按文件发送）
      this.log(`[Feishu Gateway] 开始上传文件: ${fileName}`)
      const fileType = detectFeishuFileType(fileName)
      this.log(`[Feishu Gateway] 检测到文件类型: ${fileType}`)
      const result = await uploadFileToFeishu(this.restClient, absPath, fileName, fileType)
      this.log(`[Feishu Gateway] 文件上传结果:`, JSON.stringify(result))
      if (!result.success || !result.fileKey) {
        console.warn(`[Feishu Gateway] File upload failed: ${result.error}`)
        return
      }
      await this.sendFileMessage(to, result.fileKey, replyToMessageId)
    }
  }

  /**
   * 发送支持媒体的消息：从文本中识别媒体标记并上传发送。
   */
  private async sendWithMedia(to: string, text: string, replyToMessageId?: string): Promise<void> {
    // 从文本中解析媒体标记
    const markers = parseMediaMarkers(text)

    this.log(
      `[Feishu Gateway] 解析媒体标记:`,
      JSON.stringify({
        to,
        replyToMessageId,
        textLength: text.length,
        markersCount: markers.length,
        markers: markers.map((m) => ({ type: m.type, path: m.path, name: m.name }))
      })
    )

    if (markers.length === 0) {
      // 没有媒体，按文本/卡片发送
      await this.sendMessage(to, text, replyToMessageId)
      return
    }

    // 逐个上传并发送媒体
    for (const marker of markers) {
      try {
        this.log(`[Feishu Gateway] 处理媒体:`, JSON.stringify(marker))
        // 传递从 markdown 解析出的文件名
        await this.uploadAndSendMedia(to, marker.path, marker.type, replyToMessageId, marker.name)
      } catch (error: any) {
        console.error(`[Feishu Gateway] Failed to send media: ${error.message}`)
      }
    }

    // 发送文本消息（保留完整文本作为上下文）
    await this.sendMessage(to, text, replyToMessageId)
  }

  /**
   * 处理入站消息。
   */
  private async handleInboundMessage(ctx: FeishuMessageContext): Promise<void> {
    // 群聊场景下仅在 @机器人 时响应
    if (ctx.chatType === 'group' && !ctx.mentionedBot) {
      this.log('[Feishu Gateway] Ignoring group message without bot mention')
      return
    }

    // 如果存在媒体信息，则尝试下载附件
    let attachments: IMMediaAttachment[] | undefined
    if (ctx.mediaKey && ctx.mediaType && this.restClient) {
      try {
        const result = await downloadFeishuMedia(this.restClient, ctx.messageId, ctx.mediaKey, ctx.mediaType, ctx.mediaFileName)
        if (result) {
          attachments = [
            {
              type: mapFeishuMediaType(ctx.mediaType),
              localPath: result.localPath,
              mimeType: getFeishuDefaultMimeType(ctx.mediaType, ctx.mediaFileName),
              fileName: ctx.mediaFileName,
              fileSize: result.fileSize,
              duration: ctx.mediaDuration ? ctx.mediaDuration / 1000 : undefined
            }
          ]
        }
      } catch (err: any) {
        console.error(`[Feishu] 下载媒体失败: ${err.message}`)
      }
    }

    // 构建统一 IMMessage
    const message: IMMessage = {
      platform: 'feishu',
      messageId: ctx.messageId,
      conversationId: ctx.chatId,
      senderId: ctx.senderId,
      content: ctx.content,
      chatType: ctx.chatType === 'p2p' ? 'direct' : 'group',
      timestamp: Date.now(),
      attachments
    }
    this.status.lastInboundAt = Date.now()

    // 打印完整的输入消息日志
    this.log(
      `[Feishu] 收到消息:`,
      JSON.stringify(
        {
          sender: ctx.senderOpenId,
          senderId: ctx.senderId,
          chatId: ctx.chatId,
          chatType: ctx.chatType === 'p2p' ? 'direct' : 'group',
          messageId: ctx.messageId,
          contentType: ctx.contentType,
          content: ctx.content,
          mentionedBot: ctx.mentionedBot,
          rootId: ctx.rootId,
          parentId: ctx.parentId,
          mediaKey: ctx.mediaKey,
          mediaType: ctx.mediaType,
          attachmentsCount: attachments?.length || 0
        },
        null,
        2
      )
    )

    // 构建支持媒体发送的回复函数
    const replyFn = async (text: string) => {
      // 打印完整的输出消息日志
      this.log(
        `[Feishu] 发送回复:`,
        JSON.stringify(
          {
            conversationId: ctx.chatId,
            replyToMessageId: ctx.messageId,
            replyLength: text.length,
            reply: text
          },
          null,
          2
        )
      )

      await this.sendWithMedia(ctx.chatId, text, ctx.messageId)
      this.status.lastOutboundAt = Date.now()
    }

    // 保存最近会话 ID，供主动通知复用
    this.lastChatId = ctx.chatId

    // 触发消息事件
    this.emit('message', message)

    // 添加“处理中”表情回应（异步不阻塞）
    this.addReaction(ctx.messageId, 'OnIt').catch(() => {})

    // 若已设置上层回调，则交由上层处理
    if (this.onMessageCallback) {
      try {
        await this.onMessageCallback(message, replyFn)
      } catch (error: any) {
        console.error(`[Feishu Gateway] Error in message callback: ${error.message}`)
        await replyFn(`抱歉，处理消息时出现错误：${error.message}`)
      }
    }
  }

  /**
   * 获取当前通知目标，用于持久化保存。
   */
  getNotificationTarget(): string | null {
    return this.lastChatId
  }

  /**
   * 从持久化状态恢复通知目标。
   */
  setNotificationTarget(chatId: string): void {
    this.lastChatId = chatId
  }

  /**
   * 向最近一次会话发送通知消息。
   */
  async sendNotification(text: string): Promise<void> {
    if (!this.lastChatId || !this.restClient) {
      throw new Error('No conversation available for notification')
    }
    await this.sendMessage(this.lastChatId, text)
    this.status.lastOutboundAt = Date.now()
  }

  /**
   * 向最近一次会话发送支持媒体的通知消息。
   */
  async sendNotificationWithMedia(text: string): Promise<void> {
    if (!this.lastChatId || !this.restClient) {
      throw new Error('No conversation available for notification')
    }
    await this.sendWithMedia(this.lastChatId, text, undefined)
    this.status.lastOutboundAt = Date.now()
  }
}
