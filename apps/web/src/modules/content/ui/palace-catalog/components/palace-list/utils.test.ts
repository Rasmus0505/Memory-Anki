import { describe, expect, it } from 'vitest'
import {
  getChapterPalaceGridClass,
  getListSectionWrapperClass,
  getUngroupedPalaceGridClass,
} from '@/modules/content/ui/palace-catalog/components/palace-list/utils'
import type { PalaceListLayoutMode } from '@/modules/settings/public'

const LAYOUTS: PalaceListLayoutMode[] = ['chapter-single', 'chapter-double', 'chapter-card-grid', 'flow']

describe('palace list grid classes', () => {
  // Without an explicit single column the implicit auto track sizes to the widest card's min-content
  // (nowrap titles + action buttons) and the list overflows narrow phone viewports.
  it('pins a single column on phones for every grid layout', () => {
    for (const layout of LAYOUTS) {
      for (const cls of [
        getListSectionWrapperClass(layout),
        getChapterPalaceGridClass(layout),
        getUngroupedPalaceGridClass(layout),
      ]) {
        if (!cls.includes('grid')) continue
        expect(cls.split(/\s+/)).toContain('grid-cols-1')
      }
    }
  })
})
