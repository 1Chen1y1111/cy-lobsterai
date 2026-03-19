import { i18nService } from '@/services/i18n'
import type { IMPlatform } from '@/types/im'

import { platformMeta } from '../config/platformMeta'

interface IMPlatformSidebarProps {
  platforms: IMPlatform[]
  activePlatform: IMPlatform
  togglingPlatform: IMPlatform | null
  setActivePlatform: (platform: IMPlatform) => void
  onTogglePlatform: (platform: IMPlatform) => void
  canStart: (platform: IMPlatform) => boolean
  isPlatformEnabled: (platform: IMPlatform) => boolean
  getPlatformConnected: (platform: IMPlatform) => boolean
  getPlatformStarting: (platform: IMPlatform) => boolean
}

export function IMPlatformSidebar({
  platforms,
  activePlatform,
  togglingPlatform,
  setActivePlatform,
  onTogglePlatform,
  canStart,
  isPlatformEnabled,
  getPlatformConnected,
  getPlatformStarting,
}: IMPlatformSidebarProps) {
  return (
    <div className="w-48 flex-shrink-0 border-r dark:border-claude-darkBorder border-claude-border pr-3 space-y-2 overflow-y-auto">
      {platforms.map((platform) => {
        const meta = platformMeta[platform]
        const isEnabled = isPlatformEnabled(platform)
        const isConnected = getPlatformConnected(platform) || getPlatformStarting(platform)
        const canToggle = isEnabled || canStart(platform)

        return (
          <div
            key={platform}
            onClick={() => setActivePlatform(platform)}
            className={`flex items-center p-2 rounded-xl cursor-pointer transition-colors ${
              activePlatform === platform
                ? 'bg-claude-accent/10 dark:bg-claude-accent/20 border border-claude-accent/30 shadow-subtle'
                : 'dark:bg-claude-darkSurface/50 bg-claude-surface hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover border border-transparent'
            }`}
          >
            <div className="flex flex-1 items-center">
              <div className="mr-2 flex h-7 w-7 items-center justify-center">
                <img src={meta.logo} alt={meta.label} className="w-6 h-6 object-contain rounded-md" />
              </div>
              <span
                className={`text-sm font-medium truncate ${
                  activePlatform === platform ? 'text-claude-accent' : 'dark:text-claude-darkText text-claude-text'
                }`}
              >
                {i18nService.t(platform)}
              </span>
            </div>
            <div className="flex items-center ml-2">
              <div
                className={`w-7 h-4 rounded-full flex items-center transition-colors ${
                  isEnabled ? (isConnected ? 'bg-green-500' : 'bg-yellow-500') : 'dark:bg-claude-darkBorder bg-claude-border'
                } ${!canToggle || togglingPlatform === platform ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                onClick={(event) => {
                  event.stopPropagation()
                  onTogglePlatform(platform)
                }}
              >
                <div
                  className={`w-3 h-3 rounded-full bg-white shadow-md transform transition-transform ${
                    isEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                  }`}
                />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}