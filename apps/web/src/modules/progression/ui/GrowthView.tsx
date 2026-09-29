import { useState } from 'react'
import type { ProgressionOverview } from '@/shared/api/contracts'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { LevelCard, QuestBoard, StampBook } from './GrowthPanels'
import { Starmap } from './starmap/Starmap'
import { Wardrobe } from './Wardrobe'

type PhoneTab = 'sky' | 'quests' | 'stamps' | 'wardrobe'

/**
 * One screen, no page scroll: level + quests on top, the starmap filling the rest,
 * stamp book / wardrobe in a side drawer (desktop) or sub-tabs (phone).
 */
export function GrowthView({ overview }: { overview: ProgressionOverview }) {
  const [phoneTab, setPhoneTab] = useState<PhoneTab>('sky')
  const [side, setSide] = useState<'stamps' | 'wardrobe'>('stamps')
  return (
    <div data-testid="growth-view" className="flex h-full min-h-0 flex-col gap-3 p-3 sm:p-4">
      <div className="hidden min-h-0 flex-1 grid-cols-[minmax(0,1fr)_22rem] grid-rows-[auto_minmax(0,1fr)] gap-3 lg:grid">
        <LevelCard overview={overview} />
        <QuestBoard quests={overview.quests} />
        <Starmap starmap={overview.starmap} className="min-h-0" />
        <div className="growth-paper flex min-h-0 flex-col rounded-3xl p-3">
          <Tabs value={side} onValueChange={(value) => setSide(value as 'stamps' | 'wardrobe')} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="self-start">
              <TabsTrigger value="stamps">印章册</TabsTrigger>
              <TabsTrigger value="wardrobe">衣柜</TabsTrigger>
            </TabsList>
            <TabsContent value="stamps" className="mt-3 flex min-h-0 flex-1 flex-col">
              <StampBook stamps={overview.stamps} />
            </TabsContent>
            <TabsContent value="wardrobe" className="mt-3 flex min-h-0 flex-1 flex-col">
              <Wardrobe overview={overview} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:hidden">
        <LevelCard overview={overview} compact />
        <Tabs value={phoneTab} onValueChange={(value) => setPhoneTab(value as PhoneTab)} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="self-stretch">
            <TabsTrigger value="sky" className="flex-1">星图</TabsTrigger>
            <TabsTrigger value="quests" className="flex-1">委托</TabsTrigger>
            <TabsTrigger value="stamps" className="flex-1">印章</TabsTrigger>
            <TabsTrigger value="wardrobe" className="flex-1">衣柜</TabsTrigger>
          </TabsList>
          <TabsContent value="sky" className="mt-3 min-h-0 flex-1">
            <Starmap starmap={overview.starmap} className="h-full" />
          </TabsContent>
          <TabsContent value="quests" className="mt-3 flex min-h-0 flex-1 flex-col">
            <QuestBoard quests={overview.quests} />
          </TabsContent>
          <TabsContent value="stamps" className="mt-3 flex min-h-0 flex-1 flex-col">
            <StampBook stamps={overview.stamps} />
          </TabsContent>
          <TabsContent value="wardrobe" className="mt-3 flex min-h-0 flex-1 flex-col">
            <Wardrobe overview={overview} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
