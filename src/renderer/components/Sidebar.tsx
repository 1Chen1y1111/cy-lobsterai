import { i18nService } from '@/services/i18n'
import { MagnifyingGlassIcon, PuzzlePieceIcon, ClockIcon } from '@heroicons/react/24/outline'
import SidebarToggleIcon from './icons/SidebarToggleIcon'
import ComposeIcon from './icons/ComposeIcon'
import SettingsIcon from './icons/SettingsIcon'
import { useState } from 'react'

interface SidebarProps {
  onShowSettings: () => void
  onShowLogin?: () => void
  activeView: 'cowork' | 'skills' | 'scheduledTasks' | 'mcp'
  onShowSkills: () => void
  onShowCowork?: () => void
  onShowScheduledTasks?: () => void
  onNewChat?: () => void
  isCollapsed: boolean
  onToggleCollapse: () => void
  updateBadge?: React.ReactNode
}

const Sidebar: React.FC<SidebarProps> = ({
  onShowSettings,
  activeView,
  onShowSkills,
  onShowCowork,
  onShowScheduledTasks,
  onNewChat,
  isCollapsed,
  onToggleCollapse,
  updateBadge
}) => {
  const isMac = window.electron.platform === 'darwin'

  const [isSearchOpen, setIsSearchOpen] = useState(false)

  return (
    <aside
      className={`shrink-0 dark:bg-claude-darkSurfaceMuted bg-claude-surfaceMuted flex flex-col sidebar-transition overflow-hidden ${
        isCollapsed ? 'w-0' : 'w-60'
      }`}
    >
      <div className="pt-3 pb-3">
        <div className="draggable sidebar-header-drag h-8 flex items-center justify-between px-3">
          <div className={`${isMac ? 'pl-[68px]' : ''}`}>{updateBadge}</div>
          <button
            type="button"
            onClick={onToggleCollapse}
            className="non-draggable h-8 w-8 inline-flex items-center justify-center rounded-lg dark:text-claude-darkTextSecondary text-claude-textSecondary hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
            aria-label={isCollapsed ? i18nService.t('expand') : i18nService.t('collapse')}
          >
            <SidebarToggleIcon className="h-4 w-4" isCollapsed={isCollapsed} />
          </button>
        </div>
        <div className="mt-3 space-y-1 px-3">
          <button
            type="button"
            onClick={onNewChat}
            className="w-full inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium bg-claude-accent/10 text-claude-accent hover:bg-claude-accent/20 transition-colors"
          >
            <ComposeIcon className="h-4 w-4" />
            {i18nService.t('newChat')}
          </button>

          <button
            type="button"
            className="w-full inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary hover:text-claude-text dark:hover:text-claude-darkText hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
          >
            <MagnifyingGlassIcon className="h-4 w-4" />
            {i18nService.t('search')}
          </button>
          <button
            type="button"
            className={`w-full inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
              activeView === 'scheduledTasks'
                ? 'dark:text-claude-darkText text-claude-text dark:bg-claude-darkSurfaceHover bg-claude-surfaceHover'
                : 'dark:text-claude-darkTextSecondary text-claude-textSecondary hover:text-claude-text dark:hover:text-claude-darkText hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover'
            }`}
          >
            <ClockIcon className="h-4 w-4" />
            {i18nService.t('scheduledTasks')}
          </button>
          <button
            type="button"
            onClick={() => {
              setIsSearchOpen(false)
              onShowSkills()
            }}
            className={`w-full inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
              activeView === 'skills'
                ? 'dark:text-claude-darkText text-claude-text dark:bg-claude-darkSurfaceHover bg-claude-surfaceHover'
                : 'dark:text-claude-darkTextSecondary text-claude-textSecondary hover:text-claude-text dark:hover:text-claude-darkText hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover'
            }`}
          >
            <PuzzlePieceIcon className="h-4 w-4" />
            {i18nService.t('skills')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pb-4">
        <div className="px-3 pb-2 text-sm font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
          {i18nService.t('coworkHistory')}
        </div>
        CoworkSessionList
      </div>

      <div className="px-3 pb-3 pt-1">
        <button
          type="button"
          onClick={() => onShowSettings()}
          className="w-full inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary hover:text-claude-text dark:hover:text-claude-darkText hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
          aria-label={i18nService.t('settings')}
        >
          <SettingsIcon className="h-4 w-4" />
          {i18nService.t('settings')}
        </button>
      </div>
    </aside>
  )
}

export default Sidebar
