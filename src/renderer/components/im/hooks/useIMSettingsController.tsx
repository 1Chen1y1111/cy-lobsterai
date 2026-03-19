import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import { i18nService } from '@/services/i18n'
import { imService } from '@/services/im'
import type { RootState } from '@/store'
import { clearError } from '@/store/slices/imSlice'
import type { IMConnectivityCheck, IMConnectivityTestResult, IMGatewayConfig, IMGatewayStatus, IMPlatform } from '@/types/im'
import { getVisibleIMPlatforms } from '@/utils/regionFilter'

import { getSetConfigAction } from '../config/platformActions'
import { IMConnectivityTestButton } from '../shared/IMConnectivityTestButton'

export interface IMSettingsController {
  // 全量 IM 平台配置
  config: IMGatewayConfig
  // 全量 IM 平台运行状态
  status: IMGatewayStatus
  // IM 模块全局加载状态
  isLoading: boolean
  // 当前激活的平台
  activePlatform: IMPlatform
  // 当前语言下可见的平台列表
  platforms: IMPlatform[]
  // 当前正在测试连通性的平台
  testingPlatform: IMPlatform | null
  // 各平台连通性测试结果缓存
  connectivityResults: Partial<Record<IMPlatform, IMConnectivityTestResult>>
  // 当前打开连通性弹窗的平台
  connectivityModalPlatform: IMPlatform | null
  // 当前正在切换启停的平台
  togglingPlatform: IMPlatform | null
  // 密钥字段显隐映射
  showSecrets: Record<string, boolean>
  // Telegram 白名单输入框值
  allowedUserIdInput: string
  // 设置当前激活平台
  setActivePlatform: (platform: IMPlatform) => void
  // 更新 Telegram 白名单输入框
  setAllowedUserIdInput: (value: string) => void
  // 设置连通性弹窗平台
  setConnectivityModalPlatform: (platform: IMPlatform | null) => void
  // 更新本地平台配置（Redux）
  updatePlatformConfig: (platform: IMPlatform, patch: Record<string, unknown>) => void
  // 持久化平台配置到主进程
  persistPlatformConfig: (platform: IMPlatform, overrides?: Record<string, unknown>) => Promise<void>
  // 保存当前激活平台配置
  handleSaveConfig: () => Promise<void>
  // 保存 NIM 局部配置
  saveNimConfigWithUpdate: (updates: Partial<IMGatewayConfig['nim']>) => Promise<void>
  // 触发平台连通性测试
  handleConnectivityTest: (platform: IMPlatform) => Promise<void>
  // 处理平台开关点击
  handlePlatformToggle: (platform: IMPlatform) => void
  // 判断平台是否满足启动条件
  canStart: (platform: IMPlatform) => boolean
  // 判断平台当前是否启用
  isPlatformEnabled: (platform: IMPlatform) => boolean
  // 读取平台连接状态
  getPlatformConnected: (platform: IMPlatform) => boolean
  // 读取平台启动中状态
  getPlatformStarting: (platform: IMPlatform) => boolean
  // 获取连通性检查项标题
  getCheckTitle: (code: IMConnectivityCheck['code']) => string
  // 获取连通性检查项建议
  getCheckSuggestion: (check: IMConnectivityCheck) => string | undefined
  // 格式化测试时间
  formatTestTime: (timestamp: number) => string
  // 渲染连通性测试按钮
  renderConnectivityTestButton: (platform: IMPlatform) => ReactNode
  // 判断密钥是否可见
  isSecretVisible: (key: string) => boolean
  // 切换密钥显隐
  toggleSecret: (key: string) => void
  // 新增 Telegram 白名单用户
  addTelegramAllowedUserId: () => Promise<void>
  // 删除 Telegram 白名单用户
  removeTelegramAllowedUserId: (id: string) => Promise<void>
}

// IM 设置控制器 Hook：统一管理配置编辑、网关启停和连通性测试逻辑。
export function useIMSettingsController(): IMSettingsController {
  // Redux 分发器
  const dispatch = useDispatch()
  // Redux 中的 IM 配置、状态和加载标记
  const { config, status, isLoading } = useSelector((state: RootState) => state.im)
  // 当前正在编辑/展示的平台页签
  const [activePlatform, setActivePlatform] = useState<IMPlatform>('dingtalk')
  // 正在执行连通性测试的平台（用于按钮 loading）
  const [testingPlatform, setTestingPlatform] = useState<IMPlatform | null>(null)
  // 各平台最近一次连通性测试结果
  const [connectivityResults, setConnectivityResults] = useState<Partial<Record<IMPlatform, IMConnectivityTestResult>>>({})
  // 连通性测试详情弹窗当前对应的平台
  const [connectivityModalPlatform, setConnectivityModalPlatform] = useState<IMPlatform | null>(null)
  // 当前界面语言（用于平台可见性与文案切换）
  const [language, setLanguage] = useState<'zh' | 'en'>(i18nService.getLanguage())
  // Telegram 允许用户 ID 输入值
  const [allowedUserIdInput, setAllowedUserIdInputState] = useState('')
  // IM 服务是否完成初始化，避免初始化前写入配置
  const [configLoaded, setConfigLoaded] = useState(false)
  // 正在切换启停状态的平台，防止重复触发
  const [togglingPlatform, setTogglingPlatform] = useState<IMPlatform | null>(null)
  // 各密钥字段的显隐状态
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({})
  // 记录上次已保存的 NIM 核心凭据，用于判断是否需要重连
  const savedNimConfigRef = useRef<{ appKey: string; account: string; token: string }>({
    appKey: config.nim.appKey,
    account: config.nim.account,
    token: config.nim.token
  })

  useEffect(() => {
    // 监听语言变化，动态刷新平台可见性与文案
    const unsubscribe = i18nService.subscribe(() => {
      setLanguage(i18nService.getLanguage())
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    // 切换平台时默认收起所有密钥展示
    setShowSecrets({})
  }, [activePlatform])

  useEffect(() => {
    let cancelled = false

    // 初始化 IM 服务并在组件卸载时清理资源
    void imService.init().then(() => {
      if (!cancelled) {
        setConfigLoaded(true)
      }
    })

    return () => {
      cancelled = true
      setConfigLoaded(false)
      imService.destroy()
    }
  }, [])

  const platforms = useMemo<IMPlatform[]>(() => {
    // 根据当前语言与区域策略过滤可见平台
    return getVisibleIMPlatforms(language) as IMPlatform[]
  }, [language])

  useEffect(() => {
    // 当当前平台被过滤掉时，自动回退到首个可见平台
    if (platforms.length > 0 && !platforms.includes(activePlatform)) {
      setActivePlatform(platforms[0])
    }
  }, [platforms, activePlatform])

  useEffect(() => {
    if (!connectivityModalPlatform) return

    // 测试结果弹窗支持 Esc 快捷关闭
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setConnectivityModalPlatform(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [connectivityModalPlatform])

  // 设置 Telegram 允许用户 ID 输入值。
  const setAllowedUserIdInput = (value: string) => {
    setAllowedUserIdInputState(value)
  }

  // 更新指定平台的本地配置（仅更新 Redux，不持久化）。
  const updatePlatformConfig = (platform: IMPlatform, patch: Record<string, unknown>) => {
    const actionCreator = getSetConfigAction(platform) as (payload: Record<string, unknown>) => unknown
    dispatch(actionCreator(patch) as never)
  }

  // 持久化指定平台配置，可附加覆盖字段。
  const persistPlatformConfig = async (platform: IMPlatform, overrides: Record<string, unknown> = {}) => {
    // 使用 overrides 覆盖当前平台配置后持久化
    const nextConfig = {
      ...config[platform],
      ...overrides
    }

    await imService.updateConfig({
      [platform]: nextConfig
    } as Partial<IMGatewayConfig>)
  }

  // 保存当前平台配置；若为 NIM 且凭据变化，会自动重启并复测。
  const handleSaveConfig = async () => {
    if (!configLoaded) return

    // 统一保存当前激活平台配置
    await imService.updateConfig({ [activePlatform]: config[activePlatform] } as Partial<IMGatewayConfig>)

    if (activePlatform !== 'nim') return

    const previous = savedNimConfigRef.current
    const current = config.nim
    const nimCredentialsChanged =
      current.appKey !== previous.appKey || current.account !== previous.account || current.token !== previous.token

    savedNimConfigRef.current = {
      appKey: current.appKey,
      account: current.account,
      token: current.token
    }

    // NIM 凭据变化且已启用时，重启网关并自动复测
    if (nimCredentialsChanged && current.enabled && current.appKey && current.account && current.token) {
      await imService.stopGateway('nim')
      await imService.startGateway('nim')
      await runConnectivityTest('nim', { nim: current } as Partial<IMGatewayConfig>)
    }
  }

  // 更新并保存 NIM 配置中的部分字段。
  const saveNimConfigWithUpdate = async (updates: Partial<IMGatewayConfig['nim']>) => {
    if (!configLoaded) return

    // NIM 表单的局部更新保存入口
    const updatedNimConfig = { ...config.nim, ...updates }
    await imService.updateConfig({ nim: updatedNimConfig })
  }

  // 获取连通性检查项标题（走 i18n）。
  const getCheckTitle = (code: IMConnectivityCheck['code']) => {
    return i18nService.t(`imConnectivityCheckTitle_${code}`)
  }

  // 获取连通性检查项建议，优先服务端建议，缺失时回退本地文案。
  const getCheckSuggestion = (check: IMConnectivityCheck) => {
    if (check.suggestion) return check.suggestion
    if (check.code === 'gateway_running' && check.level === 'pass') return undefined

    const suggestion = i18nService.t(`imConnectivityCheckSuggestion_${check.code}`)
    return suggestion.startsWith('imConnectivityCheckSuggestion_') ? undefined : suggestion
  }

  // 将时间戳格式化为本地可读时间。
  const formatTestTime = (timestamp: number) => {
    try {
      return new Date(timestamp).toLocaleString()
    } catch {
      return String(timestamp)
    }
  }

  // 执行平台连通性测试，并写入本地测试结果缓存。
  const runConnectivityTest = async (
    platform: IMPlatform,
    configOverride?: Partial<IMGatewayConfig>
  ): Promise<IMConnectivityTestResult | null> => {
    // 执行指定平台连通性测试并缓存结果
    setTestingPlatform(platform)
    const result = await imService.testGateway(platform, configOverride)
    if (result) {
      setConnectivityResults((previous) => ({ ...previous, [platform]: result }))
    }
    setTestingPlatform(null)
    return result
  }

  // 切换平台网关启用状态，并在启用成功后自动复测。
  const toggleGateway = async (platform: IMPlatform) => {
    if (togglingPlatform === platform) return
    setTogglingPlatform(platform)

    try {
      const isEnabled = config[platform].enabled
      const newEnabled = !isEnabled
      const setConfigAction = getSetConfigAction(platform) as (payload: Record<string, unknown>) => unknown

      dispatch(setConfigAction({ enabled: newEnabled }) as never)

      const res = { [platform]: { ...config[platform], enabled: newEnabled } } as Partial<IMGatewayConfig>
      console.log('🚀 ~ toggleGateway ~ res:', res)

      await imService.updateConfig({ [platform]: { ...config[platform], enabled: newEnabled } } as Partial<IMGatewayConfig>)

      if (newEnabled) {
        // 启用时先清理旧错误，再尝试启动；失败则回滚开关状态
        dispatch(clearError())
        const success = await imService.startGateway(platform)
        if (!success) {
          dispatch(setConfigAction({ enabled: false }) as never)
          await imService.updateConfig({ [platform]: { ...config[platform], enabled: false } } as Partial<IMGatewayConfig>)
        } else {
          // 启动成功后自动执行一次连通性测试
          await runConnectivityTest(platform, {
            [platform]: { ...config[platform], enabled: true }
          } as Partial<IMGatewayConfig>)
        }
      } else {
        // 关闭时直接停止网关
        await imService.stopGateway(platform)
      }
    } finally {
      setTogglingPlatform(null)
    }
  }

  // 判断平台是否满足启动所需的最小凭据条件。
  const canStart = (platform: IMPlatform) => {
    // 各平台启动前的最小凭据校验
    if (platform === 'dingtalk') {
      return Boolean(config.dingtalk.clientId && config.dingtalk.clientSecret)
    }
    if (platform === 'telegram') {
      return Boolean(config.telegram.botToken)
    }
    if (platform === 'discord') {
      return Boolean(config.discord.botToken)
    }
    if (platform === 'nim') {
      return Boolean(config.nim.appKey && config.nim.account && config.nim.token)
    }
    if (platform === 'xiaomifeng') {
      return Boolean(config.xiaomifeng.clientId && config.xiaomifeng.secret)
    }
    if (platform === 'qq') {
      return Boolean(config.qq.appId && config.qq.appSecret)
    }
    if (platform === 'wecom') {
      return Boolean(config.wecom.botId && config.wecom.secret)
    }

    return Boolean(config.feishu.appId && config.feishu.appSecret)
  }

  // 读取平台 enabled 开关状态。
  const isPlatformEnabled = (platform: IMPlatform) => {
    return config[platform].enabled
  }

  // 读取平台 connected 状态。
  const getPlatformConnected = (platform: IMPlatform) => {
    if (platform === 'dingtalk') return status.dingtalk.connected
    if (platform === 'telegram') return status.telegram.connected
    if (platform === 'discord') return status.discord.connected
    if (platform === 'nim') return status.nim.connected
    if (platform === 'xiaomifeng') return status.xiaomifeng?.connected ?? false
    if (platform === 'qq') return status.qq?.connected ?? false
    if (platform === 'wecom') return status.wecom?.connected ?? false
    return status.feishu.connected
  }

  // 读取平台 starting 状态（当前仅 Discord 使用）。
  const getPlatformStarting = (platform: IMPlatform) => {
    if (platform === 'discord') return status.discord.starting
    return false
  }

  // 处理连通性测试：先保存当前配置，必要时重启网关，再执行测试。
  const handleConnectivityTest = async (platform: IMPlatform) => {
    if (testingPlatform) return

    setConnectivityModalPlatform(platform)
    // 测试前先持久化当前平台配置，保证测试读取的是最新值
    await imService.updateConfig({ [platform]: config[platform] } as Partial<IMGatewayConfig>)

    const isEnabled = isPlatformEnabled(platform)
    if (isEnabled && platform !== 'nim') {
      // 对非 NIM 平台，已启用时先重启一次再测，尽量消除旧连接状态影响
      await imService.stopGateway(platform)
      await imService.startGateway(platform)
    }

    const result = await runConnectivityTest(platform, {
      [platform]: config[platform]
    } as Partial<IMGatewayConfig>)

    if (!isEnabled && result) {
      // 未启用时若鉴权通过，则自动打开该平台
      const authCheck = result.checks.find((check) => check.code === 'auth_check')
      if (authCheck?.level === 'pass') {
        void toggleGateway(platform)
      }
    }
  }

  // 处理平台开关点击，校验可切换后触发启停逻辑。
  const handlePlatformToggle = (platform: IMPlatform) => {
    if (togglingPlatform) return

    // 已启用可直接关闭；未启用需满足可启动条件
    const isEnabled = isPlatformEnabled(platform)
    const canToggle = isEnabled || canStart(platform)
    if (canToggle && !isLoading) {
      setActivePlatform(platform)
      void toggleGateway(platform)
    }
  }

  // 判断指定密钥字段是否处于可见状态。
  const isSecretVisible = (key: string) => Boolean(showSecrets[key])

  // 切换指定密钥字段的显示/隐藏状态。
  const toggleSecret = (key: string) => {
    setShowSecrets((previous) => ({
      ...previous,
      [key]: !previous[key]
    }))
  }

  // 向 Telegram 白名单新增一个用户 ID，并同步持久化。
  const addTelegramAllowedUserId = async () => {
    const id = allowedUserIdInput.trim()
    if (!id || (config.telegram.allowedUserIds || []).includes(id)) return

    // 先更新本地状态，再落盘
    const nextIds = [...(config.telegram.allowedUserIds || []), id]
    updatePlatformConfig('telegram', { allowedUserIds: nextIds })
    setAllowedUserIdInputState('')
    await persistPlatformConfig('telegram', { allowedUserIds: nextIds })
  }

  // 从 Telegram 白名单移除一个用户 ID，并同步持久化。
  const removeTelegramAllowedUserId = async (id: string) => {
    // 删除 Telegram 白名单用户并同步持久化
    const nextIds = (config.telegram.allowedUserIds || []).filter((currentId) => currentId !== id)
    updatePlatformConfig('telegram', { allowedUserIds: nextIds })
    await persistPlatformConfig('telegram', { allowedUserIds: nextIds })
  }

  // 渲染指定平台的连通性测试按钮。
  const renderConnectivityTestButton = (platform: IMPlatform) => (
    <IMConnectivityTestButton
      isLoading={testingPlatform === platform}
      hasResult={Boolean(connectivityResults[platform])}
      disabled={isLoading || testingPlatform === platform}
      onClick={() => {
        void handleConnectivityTest(platform)
      }}
      testingLabel={i18nService.t('imConnectivityTesting')}
      retestLabel={i18nService.t('imConnectivityRetest')}
      testLabel={i18nService.t('imConnectivityTest')}
    />
  )

  // 对外暴露控制器状态与操作方法。
  return {
    config,
    status,
    isLoading,
    activePlatform,
    platforms,
    testingPlatform,
    connectivityResults,
    connectivityModalPlatform,
    togglingPlatform,
    showSecrets,
    allowedUserIdInput,
    setActivePlatform,
    setAllowedUserIdInput,
    setConnectivityModalPlatform,
    updatePlatformConfig,
    persistPlatformConfig,
    handleSaveConfig,
    saveNimConfigWithUpdate,
    handleConnectivityTest,
    handlePlatformToggle,
    canStart,
    isPlatformEnabled,
    getPlatformConnected,
    getPlatformStarting,
    getCheckTitle,
    getCheckSuggestion,
    formatTestTime,
    renderConnectivityTestButton,
    isSecretVisible,
    toggleSecret,
    addTelegramAllowedUserId,
    removeTelegramAllowedUserId
  }
}

// 便捷类型：IM 设置控制器 Hook 返回值类型。
export type IMSettingsControllerState = ReturnType<typeof useIMSettingsController>
