/**
 * IM Cowork 处理器。
 * 作为适配层，让 IM（钉钉/飞书/Telegram 等）通过 CoworkRunner 执行具备工具能力的 AI 会话。
 */

import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import type { CoworkRunner, PermissionRequest } from '../libs/coworkRunner'
import type { CoworkStore, CoworkMessage } from '../coworkStore'
import type { IMStore } from './imStore'
import type { IMMessage, IMPlatform, IMMediaAttachment } from './types'
import { buildIMMediaInstruction } from './imMediaInstruction'

interface MessageAccumulator {
  messages: CoworkMessage[]
  resolve: (text: string) => void
  reject: (error: Error) => void
  timeoutId?: NodeJS.Timeout
}

interface PendingIMPermission {
  key: string
  sessionId: string
  request: PermissionRequest
  conversationId: string
  platform: IMPlatform
  createdAt: number
  timeoutId?: NodeJS.Timeout
}

const PERMISSION_CONFIRM_TIMEOUT_MS = 60_000
const ACCUMULATOR_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const IM_ALLOW_RESPONSE_RE = /^(允许|同意|yes|y)$/i
const IM_DENY_RESPONSE_RE = /^(拒绝|不同意|no|n)$/i
const IM_ALLOW_OPTION_LABEL = '允许本次操作'

export interface IMCoworkHandlerOptions {
  coworkRunner: CoworkRunner
  coworkStore: CoworkStore
  imStore: IMStore
  getSkillsPrompt?: () => Promise<string | null>
}

export class IMCoworkHandler extends EventEmitter {
  private coworkRunner: CoworkRunner
  private coworkStore: CoworkStore
  private imStore: IMStore
  private getSkillsPrompt?: () => Promise<string | null>

  // 跟踪活跃会话的消息累积状态
  private messageAccumulators: Map<string, MessageAccumulator> = new Map()

  // 跟踪由 IM 创建的会话（用于事件过滤）
  private imSessionIds: Set<string> = new Set()
  private sessionConversationMap: Map<string, { conversationId: string; platform: IMPlatform }> = new Map()
  private pendingPermissionByConversation: Map<string, PendingIMPermission> = new Map()

  constructor(options: IMCoworkHandlerOptions) {
    super()
    this.coworkRunner = options.coworkRunner
    this.coworkStore = options.coworkStore
    this.imStore = options.imStore
    this.getSkillsPrompt = options.getSkillsPrompt

    this.setupEventListeners()
  }

  /**
   * 为 CoworkRunner 注册事件监听。
   */
  private setupEventListeners(): void {
    this.coworkRunner.on('message', this.handleMessage.bind(this))
    this.coworkRunner.on('messageUpdate', this.handleMessageUpdate.bind(this))
    this.coworkRunner.on('permissionRequest', this.handlePermissionRequest.bind(this))
    this.coworkRunner.on('complete', this.handleComplete.bind(this))
    this.coworkRunner.on('error', this.handleError.bind(this))
  }

  /**
   * 使用 CoworkRunner 处理一条入站 IM 消息。
   */
  async processMessage(message: IMMessage): Promise<string> {
    const pendingPermissionReply = await this.handlePendingPermissionReply(message)
    if (pendingPermissionReply !== null) {
      return pendingPermissionReply
    }

    try {
      return await this.processMessageInternal(message, false)
    } catch (error) {
      if (!this.isSessionNotFoundError(error)) {
        if (this.shouldRetryWithFreshSession(error, message)) {
          console.warn(
            `[IMCoworkHandler] Detected recoverable API 400 for ${message.platform}:${message.conversationId}, recreating session and retrying once`
          )
          return this.processMessageInternal(message, true)
        }
        throw error
      }

      console.warn(
        `[IMCoworkHandler] Cowork session mapping is stale for ${message.platform}:${message.conversationId}, recreating session`
      )
      return this.processMessageInternal(message, true)
    }
  }

  private async processMessageInternal(message: IMMessage, forceNewSession: boolean): Promise<string> {
    const coworkSessionId = await this.getOrCreateCoworkSession(
      message.conversationId,
      message.platform,
      forceNewSession,
      message.senderId,
      message
    )
    this.sessionConversationMap.set(coworkSessionId, {
      conversationId: message.conversationId,
      platform: message.platform
    })

    const responsePromise = this.createAccumulatorPromise(coworkSessionId)

    // 启动或续跑会话
    const isActive = this.coworkRunner.isSessionActive(coworkSessionId)
    const formattedContent = this.formatMessageWithMedia(message)
    const systemPrompt = await this.buildSystemPromptWithSkills()
    const hasAvailableSkills = systemPrompt.includes('<available_skills>')
    const session = this.coworkStore.getSession(coworkSessionId)
    if (session && session.systemPrompt !== systemPrompt) {
      // Claude 恢复会话可能忽略更新后的系统提示词。
      // 重置 claudeSessionId，确保本轮以新提示词启动全新 SDK 会话。
      this.coworkStore.updateSession(coworkSessionId, {
        systemPrompt,
        claudeSessionId: null
      })
      console.log(
        '[IMCoworkHandler] System prompt changed, reset claudeSessionId for IM session',
        JSON.stringify({
          coworkSessionId,
          platform: message.platform
        })
      )
    }
    if (!hasAvailableSkills) {
      console.warn('[IMCoworkHandler] Skills auto-routing prompt missing for current IM turn')
    }

    // 打印完整的输入消息日志
    console.log(
      `[IMCoworkHandler] 处理消息:`,
      JSON.stringify(
        {
          platform: message.platform,
          conversationId: message.conversationId,
          coworkSessionId,
          isActive,
          originalContent: message.content,
          formattedContent,
          attachments: message.attachments,
          hasAvailableSkills
        },
        null,
        2
      )
    )

    const onSessionStartError = (error: unknown) => {
      this.rejectAccumulator(coworkSessionId, error instanceof Error ? error : new Error(String(error)))
    }

    if (isActive) {
      this.coworkRunner.continueSession(coworkSessionId, formattedContent, { systemPrompt }).catch(onSessionStartError)
    } else {
      this.coworkRunner
        .startSession(coworkSessionId, formattedContent, {
          workspaceRoot: session?.cwd,
          confirmationMode: 'text',
          systemPrompt
        })
        .catch(onSessionStartError)
    }

    return responsePromise
  }

  /**
   * 为 IM 会话读取或创建对应的 Cowork 会话。
   */
  private async getOrCreateCoworkSession(
    imConversationId: string,
    platform: IMPlatform,
    forceNewSession: boolean = false,
    senderId?: string,
    message?: IMMessage
  ): Promise<string> {
    if (forceNewSession) {
      const stale = this.imStore.getSessionMapping(imConversationId, platform)
      if (stale) {
        this.imStore.deleteSessionMapping(imConversationId, platform)
        this.imSessionIds.delete(stale.coworkSessionId)
        this.sessionConversationMap.delete(stale.coworkSessionId)
        this.clearPendingPermissionsBySessionId(stale.coworkSessionId)
        this.coworkRunner.stopSession(stale.coworkSessionId)
      }
    }

    // 检查是否已有会话映射
    const existing = forceNewSession ? null : this.imStore.getSessionMapping(imConversationId, platform)
    if (existing) {
      const session = this.coworkStore.getSession(existing.coworkSessionId)
      if (!session) {
        console.warn(
          `[IMCoworkHandler] Found stale mapping for ${platform}:${imConversationId}, session ${existing.coworkSessionId} is missing`
        )
        this.imStore.deleteSessionMapping(imConversationId, platform)
        this.imSessionIds.delete(existing.coworkSessionId)
        this.sessionConversationMap.delete(existing.coworkSessionId)
        this.clearPendingPermissionsBySessionId(existing.coworkSessionId)
        this.coworkRunner.stopSession(existing.coworkSessionId)
      } else {
        this.imStore.updateSessionLastActive(imConversationId, platform)
        this.imSessionIds.add(existing.coworkSessionId)
        this.sessionConversationMap.set(existing.coworkSessionId, {
          conversationId: imConversationId,
          platform
        })
        return existing.coworkSessionId
      }
    }

    // 创建新的 Cowork 会话
    return this.createCoworkSessionForConversation(imConversationId, platform, senderId, message)
  }

  private async createCoworkSessionForConversation(
    imConversationId: string,
    platform: IMPlatform,
    senderId?: string,
    message?: IMMessage
  ): Promise<string> {
    // 创建新的 Cowork 会话
    const config = this.coworkStore.getConfig()
    const title = this.buildSessionTitle(platform, imConversationId, senderId, message)
    const systemPrompt = await this.buildSystemPromptWithSkills()

    const selectedWorkspaceRoot = (config.workingDirectory || '').trim()
    if (!selectedWorkspaceRoot) {
      throw new Error('IM 工作目录未配置，请先在应用中选择任务目录。')
    }
    const resolvedWorkspaceRoot = path.resolve(selectedWorkspaceRoot)
    if (!fs.existsSync(resolvedWorkspaceRoot) || !fs.statSync(resolvedWorkspaceRoot).isDirectory()) {
      throw new Error(`IM 工作目录不存在或无效: ${resolvedWorkspaceRoot}`)
    }

    const session = this.coworkStore.createSession(
      title,
      resolvedWorkspaceRoot,
      systemPrompt,
      'local' // IM always uses local mode
    )

    // 保存会话映射
    this.imStore.createSessionMapping(imConversationId, platform, session.id)
    this.imSessionIds.add(session.id)
    this.sessionConversationMap.set(session.id, {
      conversationId: imConversationId,
      platform
    })

    return session.id
  }

  /**
   * 根据平台和发送者身份构造可读会话标题。
   *
   * NIM 标题规则：
   *   - P2P 私聊："云信-P2P-{senderName|senderId}"
   *   - Team 群聊："云信-群聊-{groupName|teamId}"
   *   - QChat：    "云信-圈组-{groupName|channelId}"
   *
   * 其他平台沿用 "IM-{platform}-{timestamp}" 风格。
   */
  private buildSessionTitle(platform: IMPlatform, _imConversationId: string, senderId?: string, message?: IMMessage): string {
    if (platform === 'nim') {
      if (message?.chatSubType === 'qchat') {
        const channelLabel = message.groupName || _imConversationId
        return `云信-圈组-${channelLabel}`
      }
      if (message?.chatType === 'group') {
        const groupLabel = message.groupName || senderId || _imConversationId
        return `云信-群聊-${groupLabel}`
      }
      // P2P direct message
      const peerLabel = message?.senderName || senderId || _imConversationId
      return `云信-P2P-${peerLabel}`
    }
    return `IM-${platform}-${Date.now()}`
  }

  private async buildSystemPromptWithSkills(): Promise<string> {
    const config = this.coworkStore.getConfig()
    const imSettings = this.imStore.getIMSettings()
    const systemPrompt = config.systemPrompt || ''

    // 构建 IM 媒体发送能力指令
    const mediaInstruction = buildIMMediaInstruction(imSettings)

    let combinedPrompt = systemPrompt

    if (imSettings.skillsEnabled && this.getSkillsPrompt) {
      const skillsPrompt = await this.getSkillsPrompt()
      if (skillsPrompt) {
        combinedPrompt = combinedPrompt ? `${skillsPrompt}\n\n${combinedPrompt}` : skillsPrompt
      }
    }

    // 将媒体指令追加在末尾，确保始终生效
    if (mediaInstruction) {
      combinedPrompt = combinedPrompt ? `${combinedPrompt}\n\n${mediaInstruction}` : mediaInstruction
    }

    return combinedPrompt
  }

  private isSessionNotFoundError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return /^Session\s.+\snot found$/i.test(message.trim())
  }

  private isRecoverableApi400Error(error: unknown): boolean {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
    if (!message.includes('400')) {
      return false
    }

    return (
      message.includes('api error') ||
      message.includes('bad_response_status_code') ||
      message.includes('invalid chat setting') ||
      message.includes('signature: field required')
    )
  }

  private shouldRetryWithFreshSession(error: unknown, message: IMMessage): boolean {
    if (!this.isRecoverableApi400Error(error)) {
      return false
    }

    const mapping = this.imStore.getSessionMapping(message.conversationId, message.platform)
    if (!mapping) {
      return false
    }

    const session = this.coworkStore.getSession(mapping.coworkSessionId)
    return Boolean(session?.claudeSessionId)
  }

  /**
   * 处理来自 CoworkRunner 的消息事件。
   */
  private handleMessage(sessionId: string, message: CoworkMessage): void {
    // 仅处理 IM 会话产生的消息
    if (!this.imSessionIds.has(sessionId)) return

    const accumulator = this.messageAccumulators.get(sessionId)
    if (accumulator) {
      accumulator.messages.push(message)
    }
  }

  /**
   * 处理消息更新事件（流式内容）。
   */
  private handleMessageUpdate(sessionId: string, messageId: string, content: string): void {
    // 仅处理 IM 会话的更新事件
    if (!this.imSessionIds.has(sessionId)) return

    const accumulator = this.messageAccumulators.get(sessionId)
    if (accumulator) {
      // 更新累积器中的消息内容
      const existingIndex = accumulator.messages.findIndex((m) => m.id === messageId)
      if (existingIndex >= 0) {
        accumulator.messages[existingIndex].content = content
      }
    }
  }

  private createConversationKey(conversationId: string, platform: IMPlatform): string {
    return `${platform}:${conversationId}`
  }

  private createAccumulatorPromise(sessionId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const existingAccumulator = this.messageAccumulators.get(sessionId)
      if (existingAccumulator) {
        if (existingAccumulator.timeoutId) {
          clearTimeout(existingAccumulator.timeoutId)
        }
        this.messageAccumulators.delete(sessionId)
        existingAccumulator.reject(new Error('Replaced by a newer IM request'))
      }

      const timeoutId = setTimeout(() => {
        const accumulator = this.messageAccumulators.get(sessionId)
        if (accumulator && accumulator.timeoutId === timeoutId) {
          const partialReply = this.formatReply(accumulator.messages)
          this.cleanupAccumulator(sessionId)
          if (partialReply && partialReply !== '处理完成，但没有生成回复。') {
            accumulator.resolve(partialReply + '\n\n[处理超时，以上为部分结果]')
          } else {
            accumulator.reject(new Error('处理超时，请稍后重试'))
          }
        }
      }, ACCUMULATOR_TIMEOUT_MS)

      // 建立消息累积器
      this.messageAccumulators.set(sessionId, {
        messages: [],
        resolve,
        reject,
        timeoutId
      })
    })
  }

  private rejectAccumulator(sessionId: string, error: Error): void {
    const accumulator = this.messageAccumulators.get(sessionId)
    if (!accumulator) return
    this.cleanupAccumulator(sessionId)
    accumulator.reject(error)
  }

  private clearPendingPermissionByKey(key: string): PendingIMPermission | null {
    const pending = this.pendingPermissionByConversation.get(key)
    if (!pending) return null

    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId)
    }
    this.pendingPermissionByConversation.delete(key)
    return pending
  }

  private clearPendingPermissionsBySessionId(sessionId: string): void {
    const keysToRemove: string[] = []
    this.pendingPermissionByConversation.forEach((pending, key) => {
      if (pending.sessionId === sessionId) {
        keysToRemove.push(key)
      }
    })
    keysToRemove.forEach((key) => this.clearPendingPermissionByKey(key))
  }

  private buildIMPermissionPrompt(request: PermissionRequest): string {
    const questions = Array.isArray(request.toolInput?.questions) ? (request.toolInput.questions as Array<Record<string, unknown>>) : []
    const firstQuestion = questions[0]
    const questionText = typeof firstQuestion?.question === 'string' ? firstQuestion.question : ''

    return [
      `检测到需要安全确认的操作（工具: ${request.toolName}）。`,
      questionText ? `说明: ${questionText}` : '说明: 当前操作涉及删除或访问任务目录外路径。',
      '请在 60 秒内回复“允许”或“拒绝”。'
    ].join('\n')
  }

  private buildAllowPermissionResult(request: PermissionRequest): PermissionResult {
    if (request.toolName !== 'AskUserQuestion') {
      return {
        behavior: 'allow',
        updatedInput: request.toolInput
      }
    }

    const input = request.toolInput && typeof request.toolInput === 'object' ? { ...(request.toolInput as Record<string, unknown>) } : {}
    const rawQuestions = Array.isArray(input.questions) ? (input.questions as Array<Record<string, unknown>>) : []

    const answers: Record<string, string> = {}
    rawQuestions.forEach((question) => {
      const questionTitle = typeof question?.question === 'string' ? question.question : ''
      if (!questionTitle) return
      const options = Array.isArray(question?.options) ? (question.options as Array<Record<string, unknown>>) : []
      const preferredOption = options.find((option) => {
        const label = typeof option?.label === 'string' ? option.label : ''
        return label.includes(IM_ALLOW_OPTION_LABEL)
      })
      const fallbackOption = options[0]
      const selectedLabel =
        typeof preferredOption?.label === 'string'
          ? preferredOption.label
          : typeof fallbackOption?.label === 'string'
            ? fallbackOption.label
            : IM_ALLOW_OPTION_LABEL
      answers[questionTitle] = selectedLabel
    })

    return {
      behavior: 'allow',
      updatedInput: {
        ...input,
        answers
      }
    }
  }

  private async handlePendingPermissionReply(message: IMMessage): Promise<string | null> {
    const key = this.createConversationKey(message.conversationId, message.platform)
    const pending = this.pendingPermissionByConversation.get(key)
    if (!pending) return null

    const normalizedReply = message.content.trim().replace(/[。！!,.，\s]+$/g, '')
    if (!normalizedReply) {
      return '当前有待确认操作，请回复“允许”或“拒绝”（60 秒内）。'
    }

    if (!this.coworkRunner.isSessionActive(pending.sessionId)) {
      this.clearPendingPermissionByKey(key)
      return '该确认请求已过期，请重新发送任务。'
    }

    if (IM_DENY_RESPONSE_RE.test(normalizedReply)) {
      this.clearPendingPermissionByKey(key)
      this.coworkRunner.respondToPermission(pending.request.requestId, {
        behavior: 'deny',
        message: 'Operation denied by IM user confirmation.'
      })
      return '已拒绝本次操作，任务未继续执行。'
    }

    if (!IM_ALLOW_RESPONSE_RE.test(normalizedReply)) {
      return '当前有待确认操作，请回复“允许”或“拒绝”（60 秒内）。'
    }

    this.clearPendingPermissionByKey(key)
    const responsePromise = this.createAccumulatorPromise(pending.sessionId)
    this.coworkRunner.respondToPermission(pending.request.requestId, this.buildAllowPermissionResult(pending.request))
    return responsePromise
  }

  /**
   * 在 IM 模式下处理权限请求，要求用户显式确认。
   */
  private handlePermissionRequest(sessionId: string, request: PermissionRequest): void {
    // 仅处理 IM 会话触发的权限请求
    if (!this.imSessionIds.has(sessionId)) return
    const conversation = this.sessionConversationMap.get(sessionId)
    if (!conversation) {
      this.coworkRunner.respondToPermission(request.requestId, {
        behavior: 'deny',
        message: 'IM session mapping missing for permission request.'
      })
      return
    }

    const key = this.createConversationKey(conversation.conversationId, conversation.platform)
    const existingPending = this.clearPendingPermissionByKey(key)
    if (existingPending) {
      this.coworkRunner.respondToPermission(existingPending.request.requestId, {
        behavior: 'deny',
        message: 'Superseded by a newer permission request.'
      })
    }

    const timeoutId = setTimeout(() => {
      const currentPending = this.pendingPermissionByConversation.get(key)
      if (!currentPending || currentPending.request.requestId !== request.requestId) {
        return
      }
      this.clearPendingPermissionByKey(key)
      this.coworkRunner.respondToPermission(request.requestId, {
        behavior: 'deny',
        message: 'Permission request timed out after 60s'
      })
    }, PERMISSION_CONFIRM_TIMEOUT_MS)

    this.pendingPermissionByConversation.set(key, {
      key,
      sessionId,
      request,
      conversationId: conversation.conversationId,
      platform: conversation.platform,
      createdAt: Date.now(),
      timeoutId
    })

    const accumulator = this.messageAccumulators.get(sessionId)
    if (accumulator) {
      const confirmationPrompt = this.buildIMPermissionPrompt(request)
      this.cleanupAccumulator(sessionId)
      accumulator.resolve(confirmationPrompt)
    }
  }

  /**
   * 处理会话完成事件。
   */
  private handleComplete(sessionId: string): void {
    // 仅处理 IM 会话的完成事件
    if (!this.imSessionIds.has(sessionId)) return

    this.clearPendingPermissionsBySessionId(sessionId)
    const accumulator = this.messageAccumulators.get(sessionId)
    if (accumulator) {
      const replyText = this.formatReply(accumulator.messages)

      // 打印完整的输出消息日志
      console.log(
        `[IMCoworkHandler] 会话完成:`,
        JSON.stringify(
          {
            sessionId,
            messageCount: accumulator.messages.length,
            replyLength: replyText.length,
            reply: replyText
          },
          null,
          2
        )
      )

      this.cleanupAccumulator(sessionId)
      accumulator.resolve(replyText)
    }
  }

  /**
   * 处理会话错误事件。
   */
  private handleError(sessionId: string, error: string): void {
    // 仅处理 IM 会话的错误事件
    if (!this.imSessionIds.has(sessionId)) return

    this.clearPendingPermissionsBySessionId(sessionId)
    const accumulator = this.messageAccumulators.get(sessionId)
    if (accumulator) {
      this.cleanupAccumulator(sessionId)
      accumulator.reject(new Error(error))
    }
  }

  /**
   * 清理消息累积器。
   */
  private cleanupAccumulator(sessionId: string): void {
    const accumulator = this.messageAccumulators.get(sessionId)
    if (accumulator?.timeoutId) {
      clearTimeout(accumulator.timeoutId)
    }
    this.messageAccumulators.delete(sessionId)
  }

  /**
   * 将累积消息格式化为回复文本。
   */
  private formatReply(messages: CoworkMessage[]): string {
    const parts: string[] = []

    for (const msg of messages) {
      // 跳过用户消息（它们是输入）
      if (msg.type === 'user') continue

      // 回复中仅包含 assistant 消息（跳过 thinking 消息）
      if (msg.type === 'assistant' && msg.content && !msg.metadata?.isThinking) {
        parts.push(msg.content)
      }
    }

    return parts.join('\n\n') || '处理完成，但没有生成回复。'
  }

  /**
   * 将媒体附件信息拼接到消息内容中。
   * 通过追加媒体元数据，让 AI 能访问相关文件路径与属性。
   */
  private formatMessageWithMedia(message: IMMessage): string {
    let content = message.content

    if (message.attachments && message.attachments.length > 0) {
      const mediaInfo = message.attachments
        .map((att: IMMediaAttachment) => {
          const parts = [`类型: ${att.type}`, `路径: ${att.localPath}`]
          if (att.fileName) parts.push(`文件名: ${att.fileName}`)
          if (att.mimeType) parts.push(`MIME: ${att.mimeType}`)
          if (att.width && att.height) parts.push(`尺寸: ${att.width}x${att.height}`)
          if (att.duration) parts.push(`时长: ${att.duration}秒`)
          if (att.fileSize) parts.push(`大小: ${(att.fileSize / 1024).toFixed(1)}KB`)
          return `- ${parts.join(', ')}`
        })
        .join('\n')

      content = content ? `${content}\n\n[附件信息]\n${mediaInfo}` : `[附件信息]\n${mediaInfo}`
    }

    return content
  }

  /**
   * 处理器销毁时执行清理。
   */
  destroy(): void {
    // 清理所有待处理累积器
    this.messageAccumulators.forEach((accumulator) => {
      if (accumulator.timeoutId) {
        clearTimeout(accumulator.timeoutId)
      }
      accumulator.reject(new Error('Handler destroyed'))
    })
    this.messageAccumulators.clear()
    this.imSessionIds.clear()
    this.sessionConversationMap.clear()

    this.pendingPermissionByConversation.forEach((pending) => {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId)
      }
    })
    this.pendingPermissionByConversation.clear()

    // 移除事件监听器
    this.coworkRunner.removeListener('message', this.handleMessage.bind(this))
    this.coworkRunner.removeListener('messageUpdate', this.handleMessageUpdate.bind(this))
    this.coworkRunner.removeListener('permissionRequest', this.handlePermissionRequest.bind(this))
    this.coworkRunner.removeListener('complete', this.handleComplete.bind(this))
    this.coworkRunner.removeListener('error', this.handleError.bind(this))
  }
}
