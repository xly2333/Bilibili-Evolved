/**
 * 直播隐身观看 · 上报拦截引擎（网页端, Bilibili Evolved 第三方插件 `live.invisibleView`）
 *
 * 10 条上报规则来自 367 条真实 HAR 实测提炼（遥测 26/26 全拦、误伤 0）:
 *   - analytics 层: data.bilibili.com / data.bilivideo.com / live-trace.bilibili.com /
 *     rumt-zh.com / nlog.daxuesoutijiang.com
 *   - low 层: api.live.bilibili.com/xlive/.../tracker/、hdslb 静态资源日志、
 *     */report、MsgReport、心跳上报
 *
 * 被拦截的请求会返回 `{"code":0}` 的空成功响应, 页面逻辑不感知。
 * 身份字段改写的完整版以独立用户脚本形式发布在:
 *   https://github.com/xly2333/bili-live-invisible
 */
/* eslint-disable */
export function installInvisible(pageWindow: any): boolean {
  if (!pageWindow || pageWindow.__BILI_INVISIBLE__) return false

  const W = pageWindow
  const ResponseC = W.Response
  const EventC = W.Event
  const XHRC = W.XMLHttpRequest

  const CONFIG = {
    // 上报拦截
    blockAnalytics: true,
    blockPresenceReport: true,
    blockLowRisk: true,
    // 调试
    debug: false,
  }

  const log = (...a: unknown[]) => { if (CONFIG.debug) console.info('[bili-invisible]', ...a) }

  // ══════════════════════════════════════════════════════════
  // 上报拦截（实测口径：367 条 HAR，遥测 26/26，误伤 0）
  // ══════════════════════════════════════════════════════════

  const STATIC_ASSET = /\.(js|css|png|jpe?g|gif|webp|svg|ico|ttf|woff2?|eot|svga|mp4|m4s|m3u8|wasm|map)(\?|#|$)/i

  const RULES = [
    { name: 'bili-data-log', tier: 'analytics',
      test: (u: string) => /^https?:\/\/data\.bilibili\.com\//.test(u) },
    { name: 'bilivideo-data-log', tier: 'analytics',
      test: (u: string) => /^https?:\/\/data\.bilivideo\.com\//.test(u) },
    { name: 'live-trace', tier: 'analytics',
      test: (u: string) => /^https?:\/\/live-trace\.bilibili\.com\//.test(u) },
    { name: 'tracker-conf', tier: 'low',
      test: (u: string) => /^https?:\/\/api\.live\.bilibili\.com\/xlive\/open-interface\/v2\/tracker\//.test(u) },
    { name: 'rum-collect', tier: 'analytics',
      test: (u: string) => /^https?:\/\/rumt-zh\.com\/collect\//.test(u) },
    { name: 'third-party-log', tier: 'analytics',
      test: (u: string) => /^https?:\/\/nlog\.daxuesoutijiang\.com\//.test(u) },
    { name: 'hdslb-log', tier: 'low',
      test: (u: string) => /^https?:\/\/[^/]*hdslb\.com\/.*\/log\//i.test(u) && !STATIC_ASSET.test(u) },
    { name: 'x-report', tier: 'low',
      test: (u: string) => /^https?:\/\/api\.live\.bilibili\.com\/.*\/report/i.test(u) },
    { name: 'msg-report', tier: 'low',
      test: (u: string) => /MsgReport/i.test(u) },
    { name: 'heartbeat-http', tier: 'low',
      test: (u: string) => /\/heart[_/]?beat/i.test(u) },
  ]

  const ruleEnabled = (r: { tier: string }) =>
    r.tier === 'analytics' ? CONFIG.blockAnalytics
      : r.tier === 'low' ? CONFIG.blockLowRisk && CONFIG.blockPresenceReport
        : false

  const blockedRule = (url: unknown) => {
    const u = String(url)
    const r = RULES.find((x) => ruleEnabled(x) && x.test(u))
    if (r) log('blocked', r.name, u)
    return r
  }

  const EMPTY_OK = () => new ResponseC('{"code":0}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

  // ══════════════════════════════════════════════════════════
  // fetch（整段安全网：内部异常一律回落原生 fetch）
  // ══════════════════════════════════════════════════════════

  const rawFetch = W.fetch
  if (typeof rawFetch === 'function') {
    W.fetch = function (input: unknown, init?: unknown) {
      try {
        const url = typeof input === 'string' ? input : (input as any)?.url || ''
        if (blockedRule(url)) return Promise.resolve(EMPTY_OK())
        return rawFetch.apply(this, arguments as any)
      } catch (e: any) {
        log('fetch fallback', e && e.message)
        return rawFetch.apply(this, arguments as any)
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // XMLHttpRequest
  // ══════════════════════════════════════════════════════════

  if (XHRC && XHRC.prototype) {
    const rawOpen = XHRC.prototype.open
    const rawSend = XHRC.prototype.send

    XHRC.prototype.open = function (method?: unknown, url?: unknown) {
      try {
        (this as any).__biliRawUrl = String(url)
        return rawOpen.apply(this, arguments as any)
      } catch (e: any) {
        log('xhr.open fallback', e && e.message)
        return rawOpen.apply(this, arguments as any)
      }
    }

    XHRC.prototype.send = function (body?: unknown) {
      try {
        const u = (this as any).__biliRawUrl || ''
        if (blockedRule(u)) {
          const xhr = this as any
          setTimeout(() => {
            const text = '{"code":0}'
            Object.defineProperties(xhr, {
              readyState: { value: 4, configurable: true },
              status: { value: 200, configurable: true },
              statusText: { value: 'OK', configurable: true },
              responseText: { value: text, configurable: true },
              response: { value: text, configurable: true },
            })
            xhr.dispatchEvent(new EventC('readystatechange'))
            xhr.dispatchEvent(new EventC('load'))
            xhr.dispatchEvent(new EventC('loadend'))
          }, 0)
          return undefined
        }
        return rawSend.apply(this, arguments as any)
      } catch (e: any) {
        log('xhr.send fallback', e && e.message)
        return rawSend.apply(this, arguments as any)
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // navigator.sendBeacon
  // ══════════════════════════════════════════════════════════

  if (W.navigator && typeof W.navigator.sendBeacon === 'function') {
    const rawBeacon = W.navigator.sendBeacon.bind(W.navigator)
    W.navigator.sendBeacon = function (url: unknown, data?: unknown) {
      try {
        if (blockedRule(url)) return true
        return rawBeacon(url, data)
      } catch (e: any) {
        log('beacon fallback', e && e.message)
        return rawBeacon(url, data)
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // 运行期开关
  // ══════════════════════════════════════════════════════════

  W.__BILI_INVISIBLE__ = {
    version: '2.1.0-be.1',
    config: CONFIG,
    rules: RULES.map((r) => ({ name: r.name, tier: r.tier })),
    set(key: string, value: unknown) {
      if (key in CONFIG) (CONFIG as any)[key] = value
      return CONFIG
    },
  }

  return true
}
