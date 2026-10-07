/**
 * 兼容入口：实现已统一到 `@/shared/lib/prefersReducedMotion`。
 *
 * 这个 hook 以前和 `useReviewFeedback.ts` 里的同名 hook 各写了一遍，行为
 * 还不一致。保留本文件只是为了让既有调用方不用改 import 路径。
 */
export {
  prefersReducedMotion,
  usePrefersReducedMotion,
} from '@/shared/lib/prefersReducedMotion'
