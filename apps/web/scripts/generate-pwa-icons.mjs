// 一次性脚本：从 public/pwa-icon.svg 生成 PWA 安装所需的 PNG 图标。
// 运行：node scripts/generate-pwa-icons.mjs（产物提交进仓库，不进 build 流程）。
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const publicDir = fileURLToPath(new URL('../public', import.meta.url))
const iconsDir = path.join(publicDir, 'icons')
const sourceSvg = await readFile(path.join(publicDir, 'pwa-icon.svg'))

await mkdir(iconsDir, { recursive: true })

// purpose:any 图标：直接整幅渲染（SVG 自带圆角底板）。
for (const size of [192, 512]) {
  await sharp(sourceSvg, { density: 384 })
    .resize(size, size)
    .png()
    .toFile(path.join(iconsDir, `icon-${size}.png`))
}

// maskable：内容缩至 80% 安全区，底色铺满整个画布（Android 会自行裁形）。
const MASKABLE_SIZE = 512
const maskableInner = Math.round(MASKABLE_SIZE * 0.8)
const maskableForeground = await sharp(sourceSvg, { density: 384 })
  .resize(maskableInner, maskableInner)
  .png()
  .toBuffer()
await sharp({
  create: {
    width: MASKABLE_SIZE,
    height: MASKABLE_SIZE,
    channels: 4,
    background: '#020617',
  },
})
  .composite([{ input: maskableForeground, gravity: 'center' }])
  .png()
  .toFile(path.join(iconsDir, 'maskable-512.png'))

// apple-touch-icon：180×180 不透明底（iOS 不支持透明，自行加圆角）。
await sharp(sourceSvg, { density: 384 })
  .resize(180, 180)
  .flatten({ background: '#020617' })
  .png()
  .toFile(path.join(iconsDir, 'apple-touch-icon.png'))

console.log('PWA icons written to public/icons/')
