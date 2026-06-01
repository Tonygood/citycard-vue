/**
 * 调试日志工具
 * 默认不输出任何日志，防止玩家通过控制台查看对手城市等敏感数据
 * 开发者如需调试，在浏览器控制台输入: window.__CITYCARD_DEBUG__ = true
 */

export function debugLog(...args) {
  if (window.__CITYCARD_DEBUG__) {
    console.log(...args)
  }
}

export function debugWarn(...args) {
  if (window.__CITYCARD_DEBUG__) {
    console.warn(...args)
  }
}
