export type DocumentView = 'mindmap' | 'article'

export function ArticleViewSwitch({ value, onChange }: { value: DocumentView; onChange: (view: DocumentView) => void }) {
  return <div className="article-view-switch" role="group" aria-label="文档视图">
    <button type="button" aria-pressed={value === 'mindmap'} onClick={() => onChange('mindmap')}>思维导图</button>
    <button type="button" aria-pressed={value === 'article'} onClick={() => onChange('article')}>文章</button>
  </div>
}
