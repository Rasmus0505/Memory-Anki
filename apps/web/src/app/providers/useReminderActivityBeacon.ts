import { useEffect } from 'react'
import { request } from '@/shared/api/http'

/** 两次心跳之间至少隔这么久：够精确，又不会把 SQLite 之外的请求数堆起来。 */
export const ACTIVITY_BEACON_INTERVAL_MS = 60_000

const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const

/**
 * 告诉后端"人现在就在操作"。
 *
 * 闲置提醒如果只认评分和保存脑图，你在手机上翻卡、点按钮时它什么也看不到，
 * 于是学得好好的也会被催。这个心跳只认真实交互：页面加载、后台轮询、
 * Service Worker 拉版本都不算，否则提醒永远不会响。
 */
export function useReminderActivityBeacon() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    let lastSentAt = 0

    const send = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastSentAt < ACTIVITY_BEACON_INTERVAL_MS) return
      lastSentAt = now
      // 心跳失败没有任何需要用户知道的信息：下一次交互会再发。
      void request('/reminders/activity', {
        method: 'POST',
        persistence: false,
      }).catch(() => undefined)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') send()
    }

    for (const event of INTERACTION_EVENTS) {
      window.addEventListener(event, send, { passive: true })
    }
    document.addEventListener('visibilitychange', onVisibility)
    // 打开 App 本身就是一次交互。
    send()

    return () => {
      for (const event of INTERACTION_EVENTS) {
        window.removeEventListener(event, send)
      }
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
}
