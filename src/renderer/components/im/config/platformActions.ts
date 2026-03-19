import {
  setDingTalkConfig,
  setDiscordConfig,
  setFeishuConfig,
  setNimConfig,
  setQQConfig,
  setTelegramConfig,
  setWecomConfig,
  setXiaomifengConfig,
} from '@/store/slices/imSlice';
import type { IMPlatform } from '@/types/im';

export const platformConfigActionMap: Record<IMPlatform, (...args: any[]) => unknown> = {
  dingtalk: setDingTalkConfig,
  feishu: setFeishuConfig,
  qq: setQQConfig,
  telegram: setTelegramConfig,
  discord: setDiscordConfig,
  nim: setNimConfig,
  xiaomifeng: setXiaomifengConfig,
  wecom: setWecomConfig,
};

export function getSetConfigAction(platform: IMPlatform) {
  return platformConfigActionMap[platform];
}