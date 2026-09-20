// 起動時の体感速度を上げるための localStorage キャッシュ。
// GAS Webアプリの応答を待たずに前回値を即描画し、裏で最新を取りに行く
// （stale-while-revalidate）。キャッシュは無くても動く前提なので、失敗は握りつぶす。

const PREFIX = 'okane-chan:v1:'

export function readCache(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? JSON.parse(raw) : null
  } catch (e) {
    return null
  }
}

export function writeCache(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch (e) {
    // 容量超過・プライベートモードなど。キャッシュ無しで動作を続ける。
  }
}
