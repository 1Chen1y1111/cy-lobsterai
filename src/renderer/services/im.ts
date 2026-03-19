import { store } from '../store';
import {
  setError,
  setConfig,
  setLoading,
  setStatus,
} from '../store/slices/imSlice';
import type {
  IMConfigResult,
  IMConnectivityTestResponse,
  IMConnectivityTestResult,
  IMGatewayConfig,
  IMGatewayResult,
  IMGatewayStatus,
  IMPlatform,
  IMStatusResult,
} from '../types/im';

/**
 * IM 服务，负责封装渲染进程与主进程之间的 IM 网关 IPC 调用。
 */
class IMService {
  /** 状态变更监听器的取消函数。 */
  private statusUnsubscribe: (() => void) | null = null;

  /** 消息监听器的取消函数。 */
  private messageUnsubscribe: (() => void) | null = null;

  /** 初始化中的 Promise，用于防止重复初始化。 */
  private initPromise: Promise<void> | null = null;

  /**
   * 初始化服务，注册监听器并加载初始配置与状态。
   */
  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInit();
    return this.initPromise;
  }

  /**
   * 销毁服务，释放监听器并允许后续重新初始化。
   */
  destroy(): void {
    if (this.statusUnsubscribe) {
      this.statusUnsubscribe();
      this.statusUnsubscribe = null;
    }
    if (this.messageUnsubscribe) {
      this.messageUnsubscribe();
      this.messageUnsubscribe = null;
    }
    this.initPromise = null;
  }

  /**
   * 从 Redux 中读取当前缓存的 IM 配置。
   */
  getConfig(): IMGatewayConfig {
    return store.getState().im.config;
  }

  /**
   * 从 Redux 中读取当前缓存的 IM 网关状态。
   */
  getStatus(): IMGatewayStatus {
    return store.getState().im.status;
  }

  /**
   * 判断当前是否至少有一个 IM 网关处于已连接状态。
   */
  isAnyConnected(): boolean {
    const status = this.getStatus();
    return (
      status.dingtalk.connected ||
      status.feishu.connected ||
      status.telegram.connected ||
      status.discord.connected ||
      status.nim.connected ||
      status.xiaomifeng.connected ||
      status.wecom.connected
    );
  }

  /**
   * 从主进程加载 IM 配置，并同步写入 Redux 状态。
   */
  async loadConfig(): Promise<IMGatewayConfig | null> {
    try {
      store.dispatch(setLoading(true));
      const result: IMConfigResult = await window.electron.im.getConfig();
      if (result.success && result.config) {
        store.dispatch(setConfig(result.config));
        return result.config;
      }

      store.dispatch(setError(result.error || 'Failed to load IM config'));
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load IM config';
      store.dispatch(setError(message));
      return null;
    } finally {
      store.dispatch(setLoading(false));
    }
  }

  /**
   * 从主进程加载当前网关状态，并同步写入 Redux 状态。
   */
  async loadStatus(): Promise<IMGatewayStatus | null> {
    try {
      const result: IMStatusResult = await window.electron.im.getStatus();
      if (result.success && result.status) {
        store.dispatch(setStatus(result.status));
        return result.status;
      }
      return null;
    } catch (error) {
      console.error('[IM Service] Failed to load status:', error);
      return null;
    }
  }

  /**
   * 更新 IM 配置，并在成功后重新拉取完整配置。
   */
  async updateConfig(config: Partial<IMGatewayConfig>): Promise<boolean> {
    try {
      store.dispatch(setLoading(true));
      const result: IMGatewayResult = await window.electron.im.setConfig(config);
      if (result.success) {
        await this.loadConfig();
        return true;
      }

      store.dispatch(setError(result.error || 'Failed to update IM config'));
      return false;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update IM config';
      store.dispatch(setError(message));
      return false;
    } finally {
      store.dispatch(setLoading(false));
    }
  }

  /**
   * 测试指定平台网关的连通性和会话可用性。
   */
  async testGateway(
    platform: IMPlatform,
    configOverride?: Partial<IMGatewayConfig>
  ): Promise<IMConnectivityTestResult | null> {
    try {
      store.dispatch(setLoading(true));
      const result: IMConnectivityTestResponse = await window.electron.im.testGateway(
        platform,
        configOverride
      );
      if (result.success && result.result) {
        return result.result;
      }

      store.dispatch(setError(result.error || `Failed to test ${platform} connectivity`));
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to test ${platform} connectivity`;
      store.dispatch(setError(message));
      return null;
    } finally {
      store.dispatch(setLoading(false));
    }
  }

  /**
   * 启动指定平台的 IM 网关，并在成功后刷新状态。
   */
  async startGateway(platform: IMPlatform): Promise<boolean> {
    try {
      store.dispatch(setLoading(true));
      store.dispatch(setError(null));
      const result: IMGatewayResult = await window.electron.im.startGateway(platform);
      if (result.success) {
        await this.loadStatus();
        return true;
      }

      store.dispatch(setError(result.error || `Failed to start ${platform} gateway`));
      return false;
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to start ${platform} gateway`;
      store.dispatch(setError(message));
      return false;
    } finally {
      store.dispatch(setLoading(false));
    }
  }

  /**
   * 停止指定平台的 IM 网关，并在成功后刷新状态。
   */
  async stopGateway(platform: IMPlatform): Promise<boolean> {
    try {
      store.dispatch(setLoading(true));
      const result: IMGatewayResult = await window.electron.im.stopGateway(platform);
      if (result.success) {
        await this.loadStatus();
        return true;
      }

      store.dispatch(setError(result.error || `Failed to stop ${platform} gateway`));
      return false;
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to stop ${platform} gateway`;
      store.dispatch(setError(message));
      return false;
    } finally {
      store.dispatch(setLoading(false));
    }
  }

  /**
   * 执行实际的初始化逻辑，内部负责注册监听器并同步初始数据。
   */
  private async _doInit(): Promise<void> {
    // 监听主进程推送的状态变化，保持前端状态实时同步。
    this.statusUnsubscribe = window.electron.im.onStatusChange((status: IMGatewayStatus) => {
      store.dispatch(setStatus(status));
    });

    // 监听收到的新消息，当前仅用于调试和运行时观察。
    this.messageUnsubscribe = window.electron.im.onMessageReceived((message) => {
      console.log('[IM Service] Message received:', message);
    });

    // 初始化时同步一次配置和状态，确保 UI 展示的是最新数据。
    await this.loadConfig();
    await this.loadStatus();
  }
}

/** IM 服务单例，供渲染进程各处复用。 */
export const imService = new IMService();