// homest（家づくりアプリ）の予算画面を埋め込むための設定。どちらも knak-lab.github.io なのでログイン状態を共有できる
export const HOMEST_EMBED_URL = import.meta.env.VITE_HOMEST_EMBED_URL || 'https://knak-lab.github.io/homest/?embed=budget'
export const HOMEST_ORIGIN = new URL(HOMEST_EMBED_URL).origin

// homest から届いたメッセージだけを通す
export const fromHomest = (e, type) => e.origin === HOMEST_ORIGIN && e.data?.type === type
