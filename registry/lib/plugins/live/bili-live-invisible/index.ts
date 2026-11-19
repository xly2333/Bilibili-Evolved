import type { PluginMetadata } from '@/plugins/plugin'
import { installInvisible } from './invisible'

/**
 * 直播隐身观看 —— 上报拦截
 *
 * 屏蔽 B 站直播间的统计上报/埋点/心跳请求（10 条规则来自 367 条真实 HAR 实测，
 * 遥测 26/26 全拦、误伤 0）。被拦截请求返回 `{"code":0}` 空成功响应，页面逻辑不感知。
 *
 * 注意: 依据本仓库的贡献范围约定（不接受绕过账号封禁等功能），
 * 本插件只包含上报拦截能力，不含任何身份字段改写。
 * 含身份字段改写的完整版以独立用户脚本形式发布在作者自己的仓库:
 *   https://github.com/xly2333/bili-live-invisible
 */
export const plugin: PluginMetadata = {
  name: 'live.invisibleView',
  displayName: '直播隐身观看',
  description: '屏蔽 B 站直播间的统计上报请求 (data.bilivideo / live-trace / rum 等 10 条实测规则).',
  author: { name: 'xly2333', link: 'https://github.com/xly2333' },
  async setup() {
    // BE 运行在 userscript sandbox 中, 必须通过 unsafeWindow 打页面补丁
    const pageWindow: any =
      typeof unsafeWindow !== 'undefined' ? unsafeWindow : (window as any)
    installInvisible(pageWindow)
  },
}
