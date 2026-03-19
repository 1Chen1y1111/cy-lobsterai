/**
 * IM 网关存储层。
 * 负责 IM 配置相关的 SQLite 读写操作。
 */

import { Database } from 'sql.js'
import {
  IMGatewayConfig,
  DingTalkConfig,
  FeishuConfig,
  QQConfig,
  TelegramConfig,
  DiscordConfig,
  NimConfig,
  XiaomifengConfig,
  WecomConfig,
  IMSettings,
  IMPlatform,
  IMSessionMapping,
  DEFAULT_DINGTALK_CONFIG,
  DEFAULT_FEISHU_CONFIG,
  DEFAULT_QQ_CONFIG,
  DEFAULT_TELEGRAM_CONFIG,
  DEFAULT_DISCORD_CONFIG,
  DEFAULT_NIM_CONFIG,
  DEFAULT_XIAOMIFENG_CONFIG,
  DEFAULT_WECOM_CONFIG,
  DEFAULT_IM_SETTINGS
} from './types'

export class IMStore {
  private db: Database
  private saveDb: () => void

  constructor(db: Database, saveDb: () => void) {
    this.db = db
    this.saveDb = saveDb
    this.initializeTables()
    this.migrateDefaults()
  }

  private initializeTables() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS im_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)

    // Cowork 模式下的 IM 会话映射表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS im_session_mappings (
        im_conversation_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        cowork_session_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        PRIMARY KEY (im_conversation_id, platform)
      );
    `)

    this.saveDb()
  }

  /**
   * 迁移历史 IM 配置，确保默认值稳定一致。
   */
  private migrateDefaults(): void {
    const platforms = ['dingtalk', 'feishu', 'telegram', 'discord', 'nim', 'xiaomifeng', 'qq', 'wecom'] as const
    let changed = false

    for (const platform of platforms) {
      const result = this.db.exec('SELECT value FROM im_config WHERE key = ?', [platform])
      if (!result[0]?.values[0]) continue

      try {
        const config = JSON.parse(result[0].values[0][0] as string)
        if (config.debug === undefined || config.debug === false) {
          config.debug = true
          const now = Date.now()
          this.db.run('UPDATE im_config SET value = ?, updated_at = ? WHERE key = ?', [JSON.stringify(config), now, platform])
          changed = true
        }
      } catch {
        // 忽略解析错误
      }
    }

    const settingsResult = this.db.exec('SELECT value FROM im_config WHERE key = ?', ['settings'])
    if (settingsResult[0]?.values[0]) {
      try {
        const settings = JSON.parse(settingsResult[0].values[0][0] as string) as Partial<IMSettings>
        // 保持 IM 与桌面端行为一致：技能自动路由默认应开启。
        // 历史 renderer 默认值可能意外持久化为 skillsEnabled: false。
        if (settings.skillsEnabled !== true) {
          settings.skillsEnabled = true
          const now = Date.now()
          this.db.run('UPDATE im_config SET value = ?, updated_at = ? WHERE key = ?', [JSON.stringify(settings), now, 'settings'])
          changed = true
        }
      } catch {
        // 忽略解析错误
      }
    }

    // 将飞书 renderMode 从 text 迁移为 card（历史 renderer 默认值不正确）
    const feishuResult = this.db.exec('SELECT value FROM im_config WHERE key = ?', ['feishu'])
    if (feishuResult[0]?.values[0]) {
      try {
        const feishuConfig = JSON.parse(feishuResult[0].values[0][0] as string) as Partial<FeishuConfig>
        if (feishuConfig.renderMode === 'text') {
          feishuConfig.renderMode = 'card'
          const now = Date.now()
          this.db.run('UPDATE im_config SET value = ?, updated_at = ? WHERE key = ?', [JSON.stringify(feishuConfig), now, 'feishu'])
          changed = true
        }
      } catch {
        // 忽略解析错误
      }
    }

    if (changed) {
      this.saveDb()
    }
  }

  // ==================== Generic Config Operations ====================

  private getConfigValue<T>(key: string): T | undefined {
    const result = this.db.exec('SELECT value FROM im_config WHERE key = ?', [key])
    if (!result[0]?.values[0]) return undefined
    const value = result[0].values[0][0] as string
    try {
      return JSON.parse(value) as T
    } catch (error) {
      console.warn(`Failed to parse im_config value for ${key}`, error)
      return undefined
    }
  }

  private setConfigValue<T>(key: string, value: T): void {
    const now = Date.now()
    this.db.run(
      `
      INSERT INTO im_config (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `,
      [key, JSON.stringify(value), now]
    )
    this.saveDb()
  }

  // ==================== Full Config Operations ====================

  getConfig(): IMGatewayConfig {
    const dingtalk = this.getConfigValue<DingTalkConfig>('dingtalk') ?? DEFAULT_DINGTALK_CONFIG
    const feishu = this.getConfigValue<FeishuConfig>('feishu') ?? DEFAULT_FEISHU_CONFIG
    const telegram = this.getConfigValue<TelegramConfig>('telegram') ?? DEFAULT_TELEGRAM_CONFIG
    const discord = this.getConfigValue<DiscordConfig>('discord') ?? DEFAULT_DISCORD_CONFIG
    const nim = this.getConfigValue<NimConfig>('nim') ?? DEFAULT_NIM_CONFIG
    const xiaomifeng = this.getConfigValue<XiaomifengConfig>('xiaomifeng') ?? DEFAULT_XIAOMIFENG_CONFIG
    const qq = this.getConfigValue<QQConfig>('qq') ?? DEFAULT_QQ_CONFIG
    const wecom = this.getConfigValue<WecomConfig>('wecom') ?? DEFAULT_WECOM_CONFIG
    const settings = this.getConfigValue<IMSettings>('settings') ?? DEFAULT_IM_SETTINGS

    // 处理 enabled 字段：出于安全考虑，默认关闭
    // 需由用户显式设置 enabled: true 才会启用
    const resolveEnabled = <T extends { enabled?: boolean }>(stored: T, defaults: T): T => {
      const merged = { ...defaults, ...stored }
      // 若未显式设置 enabled，则默认 false（更安全）
      if (stored.enabled === undefined) {
        return { ...merged, enabled: false }
      }
      return merged
    }

    return {
      dingtalk: resolveEnabled(dingtalk, DEFAULT_DINGTALK_CONFIG),
      feishu: resolveEnabled(feishu, DEFAULT_FEISHU_CONFIG),
      telegram: resolveEnabled(telegram, DEFAULT_TELEGRAM_CONFIG),
      discord: resolveEnabled(discord, DEFAULT_DISCORD_CONFIG),
      nim: resolveEnabled(nim, DEFAULT_NIM_CONFIG),
      xiaomifeng: resolveEnabled(xiaomifeng, DEFAULT_XIAOMIFENG_CONFIG),
      qq: resolveEnabled(qq, DEFAULT_QQ_CONFIG),
      wecom: resolveEnabled(wecom, DEFAULT_WECOM_CONFIG),
      settings: { ...DEFAULT_IM_SETTINGS, ...settings }
    }
  }

  setConfig(config: Partial<IMGatewayConfig>): void {
    if (config.dingtalk) {
      this.setDingTalkConfig(config.dingtalk)
    }
    if (config.feishu) {
      this.setFeishuConfig(config.feishu)
    }
    if (config.telegram) {
      this.setTelegramConfig(config.telegram)
    }
    if (config.discord) {
      this.setDiscordConfig(config.discord)
    }
    if (config.nim) {
      this.setNimConfig(config.nim)
    }
    if (config.xiaomifeng) {
      this.setXiaomifengConfig(config.xiaomifeng)
    }
    if (config.qq) {
      this.setQQConfig(config.qq)
    }
    if (config.wecom) {
      this.setWecomConfig(config.wecom)
    }
    if (config.settings) {
      this.setIMSettings(config.settings)
    }
  }

  // ==================== DingTalk Config ====================

  getDingTalkConfig(): DingTalkConfig {
    const stored = this.getConfigValue<DingTalkConfig>('dingtalk')
    return { ...DEFAULT_DINGTALK_CONFIG, ...stored }
  }

  setDingTalkConfig(config: Partial<DingTalkConfig>): void {
    const current = this.getDingTalkConfig()
    this.setConfigValue('dingtalk', { ...current, ...config })
  }

  // ==================== Feishu Config ====================

  getFeishuConfig(): FeishuConfig {
    const stored = this.getConfigValue<FeishuConfig>('feishu')
    return { ...DEFAULT_FEISHU_CONFIG, ...stored }
  }

  setFeishuConfig(config: Partial<FeishuConfig>): void {
    const current = this.getFeishuConfig()
    this.setConfigValue('feishu', { ...current, ...config })
  }

  // ==================== Telegram Config ====================

  getTelegramConfig(): TelegramConfig {
    const stored = this.getConfigValue<TelegramConfig>('telegram')
    return { ...DEFAULT_TELEGRAM_CONFIG, ...stored }
  }

  setTelegramConfig(config: Partial<TelegramConfig>): void {
    const current = this.getTelegramConfig()
    this.setConfigValue('telegram', { ...current, ...config })
  }

  // ==================== Discord Config ====================

  getDiscordConfig(): DiscordConfig {
    const stored = this.getConfigValue<DiscordConfig>('discord')
    return { ...DEFAULT_DISCORD_CONFIG, ...stored }
  }

  setDiscordConfig(config: Partial<DiscordConfig>): void {
    const current = this.getDiscordConfig()
    this.setConfigValue('discord', { ...current, ...config })
  }

  // ==================== NIM Config ====================

  getNimConfig(): NimConfig {
    const stored = this.getConfigValue<NimConfig>('nim')
    return { ...DEFAULT_NIM_CONFIG, ...stored }
  }

  setNimConfig(config: Partial<NimConfig>): void {
    const current = this.getNimConfig()
    this.setConfigValue('nim', { ...current, ...config })
  }

  // ==================== Xiaomifeng Config ====================

  getXiaomifengConfig(): XiaomifengConfig {
    const stored = this.getConfigValue<XiaomifengConfig>('xiaomifeng')
    return { ...DEFAULT_XIAOMIFENG_CONFIG, ...stored }
  }

  setXiaomifengConfig(config: Partial<XiaomifengConfig>): void {
    const current = this.getXiaomifengConfig()
    this.setConfigValue('xiaomifeng', { ...current, ...config })
  }

  // ==================== QQ Config ====================

  getQQConfig(): QQConfig {
    const stored = this.getConfigValue<QQConfig>('qq')
    return { ...DEFAULT_QQ_CONFIG, ...stored }
  }

  setQQConfig(config: Partial<QQConfig>): void {
    const current = this.getQQConfig()
    this.setConfigValue('qq', { ...current, ...config })
  }

  // ==================== WeCom Config ====================

  getWecomConfig(): WecomConfig {
    const stored = this.getConfigValue<WecomConfig>('wecom')
    return { ...DEFAULT_WECOM_CONFIG, ...stored }
  }

  setWecomConfig(config: Partial<WecomConfig>): void {
    const current = this.getWecomConfig()
    this.setConfigValue('wecom', { ...current, ...config })
  }

  // ==================== IM Settings ====================

  getIMSettings(): IMSettings {
    const stored = this.getConfigValue<IMSettings>('settings')
    return { ...DEFAULT_IM_SETTINGS, ...stored }
  }

  setIMSettings(settings: Partial<IMSettings>): void {
    const current = this.getIMSettings()
    this.setConfigValue('settings', { ...current, ...settings })
  }

  // ==================== Utility ====================

  /**
   * 清空全部 IM 配置。
   */
  clearConfig(): void {
    this.db.run('DELETE FROM im_config')
    this.saveDb()
  }

  /**
   * 判断 IM 是否已配置（至少一个平台具备凭据）。
   */
  isConfigured(): boolean {
    const config = this.getConfig()
    const hasDingTalk = !!(config.dingtalk.clientId && config.dingtalk.clientSecret)
    const hasFeishu = !!(config.feishu.appId && config.feishu.appSecret)
    const hasTelegram = !!config.telegram.botToken
    const hasDiscord = !!config.discord.botToken
    const hasNim = !!(config.nim.appKey && config.nim.account && config.nim.token)
    const hasXiaomifeng = !!(config.xiaomifeng?.clientId && config.xiaomifeng?.secret)
    const hasQQ = !!(config.qq?.appId && config.qq?.appSecret)
    const hasWecom = !!(config.wecom?.botId && config.wecom?.secret)
    return hasDingTalk || hasFeishu || hasTelegram || hasDiscord || hasNim || hasXiaomifeng || hasQQ || hasWecom
  }

  // ==================== Notification Target Persistence ====================

  /**
   * 获取指定平台持久化的通知目标。
   */
  getNotificationTarget(platform: IMPlatform): any | null {
    return this.getConfigValue<any>(`notification_target:${platform}`) ?? null
  }

  /**
   * 持久化保存指定平台的通知目标。
   */
  setNotificationTarget(platform: IMPlatform, target: any): void {
    this.setConfigValue(`notification_target:${platform}`, target)
  }

  // ==================== Session Mapping Operations ====================

  /**
   * 根据 IM 会话 ID 和平台读取会话映射。
   */
  getSessionMapping(imConversationId: string, platform: IMPlatform): IMSessionMapping | null {
    const result = this.db.exec(
      'SELECT im_conversation_id, platform, cowork_session_id, created_at, last_active_at FROM im_session_mappings WHERE im_conversation_id = ? AND platform = ?',
      [imConversationId, platform]
    )
    if (!result[0]?.values[0]) return null
    const row = result[0].values[0]
    return {
      imConversationId: row[0] as string,
      platform: row[1] as IMPlatform,
      coworkSessionId: row[2] as string,
      createdAt: row[3] as number,
      lastActiveAt: row[4] as number
    }
  }

  /**
   * 创建新的会话映射。
   */
  createSessionMapping(imConversationId: string, platform: IMPlatform, coworkSessionId: string): IMSessionMapping {
    const now = Date.now()
    this.db.run(
      'INSERT INTO im_session_mappings (im_conversation_id, platform, cowork_session_id, created_at, last_active_at) VALUES (?, ?, ?, ?, ?)',
      [imConversationId, platform, coworkSessionId, now, now]
    )
    this.saveDb()
    return {
      imConversationId,
      platform,
      coworkSessionId,
      createdAt: now,
      lastActiveAt: now
    }
  }

  /**
   * 更新会话映射的最近活跃时间。
   */
  updateSessionLastActive(imConversationId: string, platform: IMPlatform): void {
    const now = Date.now()
    this.db.run('UPDATE im_session_mappings SET last_active_at = ? WHERE im_conversation_id = ? AND platform = ?', [
      now,
      imConversationId,
      platform
    ])
    this.saveDb()
  }

  /**
   * 删除会话映射。
   */
  deleteSessionMapping(imConversationId: string, platform: IMPlatform): void {
    this.db.run('DELETE FROM im_session_mappings WHERE im_conversation_id = ? AND platform = ?', [imConversationId, platform])
    this.saveDb()
  }

  /**
   * 列出指定平台（或全部平台）的会话映射。
   */
  listSessionMappings(platform?: IMPlatform): IMSessionMapping[] {
    const query = platform
      ? 'SELECT im_conversation_id, platform, cowork_session_id, created_at, last_active_at FROM im_session_mappings WHERE platform = ? ORDER BY last_active_at DESC'
      : 'SELECT im_conversation_id, platform, cowork_session_id, created_at, last_active_at FROM im_session_mappings ORDER BY last_active_at DESC'
    const params = platform ? [platform] : []
    const result = this.db.exec(query, params)
    if (!result[0]?.values) return []
    return result[0].values.map((row) => ({
      imConversationId: row[0] as string,
      platform: row[1] as IMPlatform,
      coworkSessionId: row[2] as string,
      createdAt: row[3] as number,
      lastActiveAt: row[4] as number
    }))
  }
}
