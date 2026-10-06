import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test, type Page } from './fixtures'

type ArticleNode = {
  data: { uid: string; text: string; note?: string; articleBody?: unknown; [key: string]: unknown }
  children: ArticleNode[]
}
type EditorDocument = { root: ArticleNode }

const palaceId = 9401
const firstUid = 'article-review-section-1'
const originalTitle = '从理解到主动回忆'
const editedTitle = '从理解到长期记忆'
const editedBody = '把知识组织成可以主动提取的线索，并用间隔复习巩固记忆。'

/** Simulate only editor, reading progress and its empty subject picker; other APIs stay offline. */
async function installArticleFixture(page: Page) {
  let document: EditorDocument = {
    root: {
      data: { uid: 'article-review-root', text: '学习笔记 · 记忆与理解', note: '一份可阅读、可编辑，也能随时返回导图的学习文档。' },
      children: Array.from({ length: 14 }, (_, index) => ({
        data: {
          uid: `article-review-section-${index + 1}`,
          text: index === 0 ? originalTitle : `学习章节 ${index + 1} · 建立知识之间的联系`,
          articleBody: {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: '阅读不是重复浏览，而是把新知识与已有经验连接起来。先理解，再用自己的语言解释，最后主动回忆。' }] },
              { type: 'paragraph', content: [{ type: 'text', text: '保留每个知识点的稳定身份，在文章与导图之间切换时，正文、层级和阅读位置都应该保持一致。', marks: [{ type: 'bold' }] }] },
            ],
          },
        },
        children: [],
      })),
    },
  }
  await page.route('**/api/v1/subjects', (route) => route.fulfill({ json: [] }))
  const saves: EditorDocument[] = []
  let revision = 1
  const palace = { id: palaceId, title: '学习笔记 · 记忆与理解', description: '', mastered: false, attachments: [], chapters: [] }
  await page.route(`**/api/v1/palaces/${palaceId}/editor*`, async (route) => {
    if (route.request().method() === 'PUT') {
      const payload = route.request().postDataJSON() as { editor_doc: EditorDocument }
      document = payload.editor_doc
      saves.push(document)
      revision += 1
    } else if (route.request().method() !== 'GET') {
      await route.fulfill({ status: 405, json: { detail: 'Unsupported fixture method' } })
      return
    }
    await route.fulfill({ json: {
      palace, editor_doc: document, editor_config: {}, editor_local_config: {}, lang: 'zh',
      editor_fingerprint: `article-e2e-${revision}`,
    } })
  })
  await page.route('**/api/v1/content/article-reading/*', async (route) => {
    const owner = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1) ?? '')
    if (owner !== `palace:${palaceId}`) {
      await route.fulfill({ status: 404, json: { detail: 'Unknown fixture owner' } })
      return
    }
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { owner_id: owner, cursor: null } })
    } else if (route.request().method() === 'PUT') {
      const payload = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({ json: { owner_id: owner, cursor: {
        ...payload, owner_id: owner, block_offset: payload.block_offset ?? null,
        revision: Number(payload.expected_revision) + 1, updated_at: '2026-01-01T12:00:00Z',
      } } })
    } else {
      await route.fulfill({ status: 405, json: { detail: 'Unsupported fixture method' } })
    }
  })
  return { saves, currentDocument: () => document }
}

async function openArticle(page: Page) {
  // Exercise the actual lazy palace route, rather than a component-only harness.
  await page.goto(`/palaces/${palaceId}/edit`)
  // The palace host's optional subject drawer otherwise covers the mobile article.
  await expect(page.getByRole('group', { name: '文档视图' })).toBeVisible()
  const closeSubjectDrawer = page.getByRole('button', { name: '收起学科与绑定', exact: true })
  if (await closeSubjectDrawer.isVisible()) await closeSubjectDrawer.click()
  await page.getByRole('group', { name: '文档视图' }).getByRole('button', { name: '文章', exact: true }).click()
  await expect(page.getByTestId('article-workspace')).toBeVisible()
}

async function switchView(page: Page, name: '文章' | '思维导图') {
  const button = page.getByRole('group', { name: '文档视图' }).getByRole('button', { name, exact: true })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

async function reviewScreenshot(page: Page, projectName: string, name: string) {
  if (process.env.ARTICLE_REVIEW_SCREENSHOTS !== '1') return
  // Opt-in review artifacts contain synthetic fixture content, never live user data.
  const directory = resolve(process.cwd(), '../../deliverables/article-review')
  await mkdir(directory, { recursive: true })
  const path = resolve(directory, `${projectName}-${name}.png`)
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
  await test.info().attach(name, { path, contentType: 'image/png' })
}

function findNode(document: EditorDocument, uid: string): ArticleNode | undefined {
  const visit = (node: ArticleNode): ArticleNode | undefined => node.data.uid === uid
    ? node : node.children.map(visit).find(Boolean)
  return visit(document.root)
}

test('article reading, title/body editing and new structure preserve node UIDs across views', async ({ page }, testInfo) => {
  const fixture = await installArticleFixture(page)
  await openArticle(page)
  const article = page.getByTestId('article-workspace')
  const section = article.locator(`[data-article-uid="${firstUid}"]`)
  await expect(section.getByRole('heading', { name: originalTitle, exact: true })).toBeVisible()
  await expect(section).toContainText('阅读不是重复浏览')
  await reviewScreenshot(page, testInfo.project.name, 'reading')

  await article.getByRole('button', { name: '编辑文章', exact: true }).click()
  const title = section.getByRole('textbox', { name: '知识点标题', exact: true })
  await title.fill(editedTitle)
  // Select by stable UID; the editor's label can lag a title echo until remount.
  const bodyEditor = section.locator('[role="textbox"][aria-multiline="true"]')
  await expect(bodyEditor).toBeVisible()
  await bodyEditor.fill(editedBody)
  await expect(title).toHaveText(editedTitle)
  await expect(bodyEditor).toHaveText(editedBody)
  await section.getByRole('button', { name: '新增下级', exact: true }).click()
  const created = article.locator('[data-article-uid][data-active="true"]')
  await expect(article.locator('[data-article-uid]')).toHaveCount(16)
  await expect(created).not.toHaveAttribute('data-article-uid', firstUid)
  const createdUid = await created.getAttribute('data-article-uid')
  expect(createdUid).toBeTruthy()
  expect(createdUid).not.toBe(firstUid)
  await created.getByRole('textbox', { name: '知识点标题', exact: true }).fill('新知识点 · 提取练习')
  await reviewScreenshot(page, testInfo.project.name, 'editing')
  await article.getByRole('button', { name: '完成编辑', exact: true }).click()

  await expect.poll(() => findNode(fixture.currentDocument(), firstUid)?.children.some((node) => node.data.uid === createdUid)).toBe(true)
  const saved = findNode(fixture.currentDocument(), firstUid)
  expect(saved?.data.text).toBe(editedTitle)
  expect(JSON.stringify(saved?.data.articleBody)).toContain(editedBody)
  expect(fixture.saves.length).toBeGreaterThan(0)

  await switchView(page, '思维导图')
  await expect(article).toBeHidden()
  const canvasNode = page.locator(`.react-flow__node[data-id="${firstUid}"]`)
  await expect(canvasNode).toContainText(editedTitle)
  await expect(page.locator(`.react-flow__node[data-id="${createdUid}"]`)).toContainText('新知识点 · 提取练习')
  await reviewScreenshot(page, testInfo.project.name, 'mindmap')
  await switchView(page, '文章')
  await expect(section.getByRole('heading', { name: editedTitle, exact: true })).toBeVisible()
  await expect(section).toContainText(editedBody)
  await expect(article.locator(`[data-article-uid="${createdUid}"]`)).toContainText('新知识点 · 提取练习')
})

test('article outline overlays narrow screens without overflow and retains reading scroll across view toggles', async ({ page }, testInfo) => {
  await installArticleFixture(page)
  await openArticle(page)
  const article = page.getByTestId('article-workspace')
  const scroll = article.locator('.article-scroll')
  await expect.poll(() => scroll.evaluate((element) => element.clientHeight)).toBeGreaterThan(100)
  await article.getByRole('button', { name: '目录', exact: true }).click()
  const outline = article.getByRole('navigation', { name: '文章目录' })
  await expect(outline).toBeVisible()
  const narrow = (page.viewportSize()?.width ?? 1280) <= 640
  if (narrow) {
    await expect(outline).toHaveCSS('position', 'absolute')
    const outlineBox = await outline.boundingBox()
    const scrollBox = await scroll.boundingBox()
    expect(outlineBox).not.toBeNull()
    expect(scrollBox).not.toBeNull()
    expect(Math.abs(outlineBox!.x - scrollBox!.x)).toBeLessThanOrEqual(2)
    expect(scrollBox!.width).toBeGreaterThan(outlineBox!.width)
  }
  const widthDiagnostics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    overflowing: Array.from(document.querySelectorAll<HTMLElement>('main *'))
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1 && element.getBoundingClientRect().width > 0)
      .slice(0, 15).map((element) => ({ tag: element.tagName, class: element.className, width: element.getBoundingClientRect().width })),
  }))
  await testInfo.attach('article-width-diagnostics', { body: JSON.stringify(widthDiagnostics, null, 2), contentType: 'application/json' })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  await reviewScreenshot(page, testInfo.project.name, 'outline')
  await outline.getByRole('textbox', { name: '搜索文章' }).fill('学习章节 8')
  await expect(outline.getByRole('button')).toHaveCount(1)
  await outline.getByRole('button', { name: '学习章节 8 · 建立知识之间的联系' }).click()
  await article.getByRole('button', { name: '目录', exact: true }).click()
  await expect(outline).toBeHidden()
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(200)
  const before = await scroll.evaluate((element) => element.scrollTop)
  await reviewScreenshot(page, testInfo.project.name, 'scrolled')
  await switchView(page, '思维导图')
  await expect(article).toBeHidden()
  await switchView(page, '文章')
  await expect(article).toBeVisible()
  await expect.poll(async () => Math.abs(await scroll.evaluate((element) => element.scrollTop) - before)).toBeLessThanOrEqual(2)
  await expect.poll(() => scroll.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  await reviewScreenshot(page, testInfo.project.name, 'scroll-restored')
})
