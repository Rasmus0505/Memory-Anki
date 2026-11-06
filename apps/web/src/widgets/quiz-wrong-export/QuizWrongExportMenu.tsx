import { Download, LoaderCircle } from 'lucide-react'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { useExportWrongQuestions } from './useExportWrongQuestions'

/**
 * 「导出错题」shared by 随心做题 and 关联题目. The trigger opens a two-choice
 * menu instead of a modal: the scope decision is the whole interaction.
 * 错题 follows the red index dots — currently answered wrong, not ever-wrong.
 */
export function QuizWrongExportMenu({
  wrongQuestions,
}: {
  wrongQuestions: readonly PalaceQuizQuestion[]
}) {
  const { exporting, exportWrongQuestions } = useExportWrongQuestions()
  const count = wrongQuestions.length

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label="导出错题"
          title={count > 0 ? '把窗口内全部错题复制到剪贴板' : '还没有答错的题'}
          disabled={count === 0 || exporting != null}
        >
          {exporting != null
            ? <LoaderCircle className="size-4 animate-spin" />
            : <Download className="size-4" />}
          <span className="hidden sm:inline">导出错题</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onSelect={() => void exportWrongQuestions(wrongQuestions, 'wrong-only')}>
          <div className="flex flex-col gap-0.5">
            <span>全部错题</span>
            <span className="text-xs font-normal leading-relaxed text-muted-foreground">
              只复制当前答错的 {count} 道题
            </span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void exportWrongQuestions(wrongQuestions, 'with-palaces')}>
          <div className="flex flex-col gap-0.5">
            <span>全部错题 + 完整宫殿</span>
            <span className="text-xs font-normal leading-relaxed text-muted-foreground">
              另附涉及宫殿的脑图和全部题目
            </span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
