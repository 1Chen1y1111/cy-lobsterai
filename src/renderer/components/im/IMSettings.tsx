import { IMPlatformHeader } from './shared/IMPlatformHeader'
import { IMPlatformSidebar } from './shared/IMPlatformSidebar'
import { IMConnectivityResultModal } from './shared/IMConnectivityResultModal'
import { renderPlatformPanel } from './platforms/renderPlatformPanel'
import { useIMSettingsController } from './hooks/useIMSettingsController'

export default function IMSettings() {
  const controller = useIMSettingsController()

  return (
    <div className="flex h-full gap-4">
      <IMPlatformSidebar
        platforms={controller.platforms}
        activePlatform={controller.activePlatform}
        togglingPlatform={controller.togglingPlatform}
        setActivePlatform={controller.setActivePlatform}
        onTogglePlatform={controller.handlePlatformToggle}
        canStart={controller.canStart}
        isPlatformEnabled={controller.isPlatformEnabled}
        getPlatformConnected={controller.getPlatformConnected}
        getPlatformStarting={controller.getPlatformStarting}
      />

      <div className="flex-1 min-w-0 pl-4 pr-2 space-y-4 overflow-y-auto [scrollbar-gutter:stable]">
        <IMPlatformHeader
          activePlatform={controller.activePlatform}
          connected={controller.getPlatformConnected(controller.activePlatform)}
          starting={controller.getPlatformStarting(controller.activePlatform)}
        />

        {renderPlatformPanel(controller)}
      </div>

      <IMConnectivityResultModal
        platform={controller.connectivityModalPlatform}
        testingPlatform={controller.testingPlatform}
        results={controller.connectivityResults}
        onClose={() => controller.setConnectivityModalPlatform(null)}
        onRetest={(platform) => {
          void controller.handleConnectivityTest(platform)
        }}
        getCheckTitle={controller.getCheckTitle}
        getCheckSuggestion={controller.getCheckSuggestion}
        formatTestTime={controller.formatTestTime}
      />
    </div>
  )
}
