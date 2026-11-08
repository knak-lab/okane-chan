// 起動時の体感速度を上げるための端末キャッシュ。
// GAS Webアプリの応答を待たずに前回値を即描画し、裏で最新を取りに行く
// （stale-while-revalidate）。中身は端末の金庫（vault）に暗号化して置き、鍵がかかっている間は読めない。
// キャッシュは無くても動く前提なので、失敗は握りつぶす。
import { vaultGet, vaultSet } from '../auth/vault'

const PREFIX = 'cache:'

export function readCache(key) {
  try {
    return vaultGet(PREFIX + key)
  } catch (e) {
    return null
  }
}

export function writeCache(key, value) {
  try {
    vaultSet(PREFIX + key, value)
  } catch (e) {
    // 鍵がかかっている・容量超過など。キャッシュ無しで動作を続ける。
  }
}
