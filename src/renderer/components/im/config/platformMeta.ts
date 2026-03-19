import { SignalIcon, XCircleIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import type { ComponentType } from 'react';

import { i18nService } from '@/services/i18n';
import type {
  IMConnectivityCheck,
  IMConnectivityTestResult,
  IMPlatform,
} from '@/types/im';

export const platformMeta: Record<IMPlatform, { label: string; logo: string }> = {
  dingtalk: { label: '钉钉', logo: 'dingding.png' },
  feishu: { label: '飞书', logo: 'feishu.png' },
  qq: { label: 'QQ', logo: 'qq_bot.jpeg' },
  telegram: { label: 'Telegram', logo: 'telegram.svg' },
  discord: { label: 'Discord', logo: 'discord.svg' },
  nim: { label: '云信', logo: 'nim.png' },
  xiaomifeng: { label: '小蜜蜂', logo: 'xiaomifeng.png' },
  wecom: { label: '企业微信', logo: 'wecom.png' },
};

export const verdictColorClass: Record<IMConnectivityTestResult['verdict'], string> = {
  pass: 'bg-green-500/15 text-green-600 dark:text-green-400',
  warn: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300',
  fail: 'bg-red-500/15 text-red-600 dark:text-red-400',
};

export const checkLevelColorClass: Record<IMConnectivityCheck['level'], string> = {
  pass: 'text-green-600 dark:text-green-400',
  info: 'text-sky-600 dark:text-sky-400',
  warn: 'text-yellow-700 dark:text-yellow-300',
  fail: 'text-red-600 dark:text-red-400',
};

export const verdictIconMap: Record<
  IMConnectivityTestResult['verdict'],
  ComponentType<{ className?: string }>
> = {
  pass: CheckCircleIcon,
  warn: ExclamationTriangleIcon,
  fail: XCircleIcon,
};

export const connectivityButtonIcon = SignalIcon;

export const errorMessageI18nMap: Record<string, string> = {
  账号已在其它地方登录: 'kickedByOtherClient',
};

export function translateIMError(error: string | null): string {
  if (!error) return '';

  const i18nKey = errorMessageI18nMap[error];
  if (i18nKey) {
    return i18nService.t(i18nKey);
  }

  return error;
}