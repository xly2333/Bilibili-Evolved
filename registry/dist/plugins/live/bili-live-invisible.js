/**
 * Bilibili Evolved 插件 · 直播隐身观看 (live.invisibleView)
 *
 * 手工构建产物 (UMD, libraryExport: 'plugin'), 与官方 webpack 构建的加载语义一致:
 *   - BE 的 loadFeatureCode 沙箱中走 `exports['live/bili-live-invisible'] = factory()` 分支,
 *     导出值即 PluginMetadata { name, displayName, setup }
 *   - 源码: registry/lib/plugins/live/bili-live-invisible/ (本仓库)
 *   - 独立完整版用户脚本: https://github.com/xly2333/bili-live-invisible
 */
!function (root, factory) {
  if (typeof exports === 'object' && typeof module === 'object') { module.exports = factory() }
  else if (typeof define === 'function' && define.amd) { define([], factory) }
  else if (typeof exports === 'object') { exports['live/bili-live-invisible'] = factory() }
  else { root['live/bili-live-invisible'] = factory() }
}(globalThis, function () {
  'use strict';

  /**
   * 上报拦截引擎（10 条规则来自 367 条真实 HAR 实测, 遥测 26/26 全拦、误伤 0）。
   * 打补丁的对象是页面真实 window (BE sandbox 里由 unsafeWindow 提供),
   * 被拦截的请求返回 {"code":0} 空成功响应, 页面逻辑不感知。
   */
  function installInvisible(pageWindow) {
    if (!pageWindow || pageWindow.__BILI_INVISIBLE__) return false;

    var W = pageWindow;
    var ResponseC = W.Response;
    var EventC = W.Event;
    var XHRC = W.XMLHttpRequest;

    var CONFIG = {
      // 上报拦截
      blockAnalytics: true,
      blockPresenceReport: true,
      blockLowRisk: true,
      // 调试
      debug: false,
    };

    var log = function () {
      if (CONFIG.debug) console.info.apply(console, ['[bili-invisible]'].concat([].slice.call(arguments)));
    };

    // ════════════════════════════════════════════════════════
    // 上报拦截（实测口径：367 条 HAR，遥测 26/26，误伤 0）
    // ════════════════════════════════════════════════════════

    var STATIC_ASSET = /\.(js|css|png|jpe?g|gif|webp|svg|ico|ttf|woff2?|eot|svga|mp4|m4s|m3u8|wasm|map)(\?|#|$)/i;

    var RULES = [
      { name: 'bili-data-log', tier: 'analytics',
        test: function (u) { return /^https?:\/\/data\.bilibili\.com\//.test(u); } },
      { name: 'bilivideo-data-log', tier: 'analytics',
        test: function (u) { return /^https?:\/\/data\.bilivideo\.com\//.test(u); } },
      { name: 'live-trace', tier: 'analytics',
        test: function (u) { return /^https?:\/\/live-trace\.bilibili\.com\//.test(u); } },
      { name: 'tracker-conf', tier: 'low',
        test: function (u) { return /^https?:\/\/api\.live\.bilibili\.com\/xlive\/open-interface\/v2\/tracker\//.test(u); } },
      { name: 'rum-collect', tier: 'analytics',
        test: function (u) { return /^https?:\/\/rumt-zh\.com\/collect\//.test(u); } },
      { name: 'third-party-log', tier: 'analytics',
        test: function (u) { return /^https?:\/\/nlog\.daxuesoutijiang\.com\//.test(u); } },
      { name: 'hdslb-log', tier: 'low',
        test: function (u) { return /^https?:\/\/[^/]*hdslb\.com\/.*\/log\//i.test(u) && !STATIC_ASSET.test(u); } },
      { name: 'x-report', tier: 'low',
        test: function (u) { return /^https?:\/\/api\.live\.bilibili\.com\/.*\/report/i.test(u); } },
      { name: 'msg-report', tier: 'low',
        test: function (u) { return /MsgReport/i.test(u); } },
      { name: 'heartbeat-http', tier: 'low',
        test: function (u) { return /\/heart[_/]?beat/i.test(u); } },
    ];

    var ruleEnabled = function (r) {
      return r.tier === 'analytics' ? CONFIG.blockAnalytics
        : r.tier === 'low' ? CONFIG.blockLowRisk && CONFIG.blockPresenceReport
          : false;
    };

    var blockedRule = function (url) {
      var u = String(url);
      var r = null;
      for (var i = 0; i < RULES.length; i++) {
        if (ruleEnabled(RULES[i]) && RULES[i].test(u)) { r = RULES[i]; break; }
      }
      if (r) log('blocked', r.name, u);
      return r;
    };

    var EMPTY_OK = function () {
      return new ResponseC('{"code":0}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    // ════════════════════════════════════════════════════════
    // fetch（整段安全网：内部异常一律回落原生 fetch）
    // ════════════════════════════════════════════════════════

    var rawFetch = W.fetch;
    if (typeof rawFetch === 'function') {
      W.fetch = function (input, init) {
        try {
          var url = typeof input === 'string' ? input : (input && input.url) || '';
          if (blockedRule(url)) return Promise.resolve(EMPTY_OK());
          return rawFetch.apply(this, arguments);
        } catch (e) {
          log('fetch fallback', e && e.message);
          return rawFetch.apply(this, arguments);
        }
      };
    }

    // ════════════════════════════════════════════════════════
    // XMLHttpRequest
    // ════════════════════════════════════════════════════════

    if (XHRC && XHRC.prototype) {
      var rawOpen = XHRC.prototype.open;
      var rawSend = XHRC.prototype.send;

      XHRC.prototype.open = function (method, url) {
        try {
          this.__biliRawUrl = String(url);
          return rawOpen.apply(this, arguments);
        } catch (e) {
          log('xhr.open fallback', e && e.message);
          return rawOpen.apply(this, arguments);
        }
      };

      XHRC.prototype.send = function (body) {
        try {
          var u = this.__biliRawUrl || '';
          if (blockedRule(u)) {
            var xhr = this;
            setTimeout(function () {
              var text = '{"code":0}';
              Object.defineProperties(xhr, {
                readyState: { value: 4, configurable: true },
                status: { value: 200, configurable: true },
                statusText: { value: 'OK', configurable: true },
                responseText: { value: text, configurable: true },
                response: { value: text, configurable: true },
              });
              xhr.dispatchEvent(new EventC('readystatechange'));
              xhr.dispatchEvent(new EventC('load'));
              xhr.dispatchEvent(new EventC('loadend'));
            }, 0);
            return undefined;
          }
          return rawSend.apply(this, arguments);
        } catch (e) {
          log('xhr.send fallback', e && e.message);
          return rawSend.apply(this, arguments);
        }
      };
    }

    // ════════════════════════════════════════════════════════
    // navigator.sendBeacon
    // ════════════════════════════════════════════════════════

    if (W.navigator && typeof W.navigator.sendBeacon === 'function') {
      var rawBeacon = W.navigator.sendBeacon.bind(W.navigator);
      W.navigator.sendBeacon = function (url, data) {
        try {
          if (blockedRule(url)) return true;
          return rawBeacon(url, data);
        } catch (e) {
          log('beacon fallback', e && e.message);
          return rawBeacon(url, data);
        }
      };
    }

    // ════════════════════════════════════════════════════════
    // 运行期开关
    // ════════════════════════════════════════════════════════

    W.__BILI_INVISIBLE__ = {
      version: '2.1.0-be.1',
      config: CONFIG,
      rules: RULES.map(function (r) { return { name: r.name, tier: r.tier }; }),
      set: function (key, value) {
        if (key in CONFIG) CONFIG[key] = value;
        return CONFIG;
      },
    };

    return true;
  }

  return {
    name: 'live.invisibleView',
    displayName: '直播隐身观看',
    description: '屏蔽 B 站直播间的统计上报请求 (data.bilivideo / live-trace / rum 等 10 条实测规则).',
    author: { name: 'xly2333', link: 'https://github.com/xly2333' },
    async setup() {
      // BE 运行在 userscript sandbox 中, 必须通过 unsafeWindow 打页面补丁;
      // 独立运行 (直接 eval / 手动安装) 时回落到当前 window
      var pageWindow =
        (typeof unsafeWindow !== 'undefined' && unsafeWindow) ||
        (typeof window !== 'undefined' && window) ||
        globalThis;
      installInvisible(pageWindow);
    },
  };
});
