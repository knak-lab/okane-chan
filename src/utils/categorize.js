import { loadCustomRules } from './customRules'

const CATEGORY_RULES = [
  {
    category: '消・食費',
    keywords: [
      'マクドナルド', 'マック', 'モスバーガー', 'バーガーキング', 'ケンタッキー', 'KFC',
      'すき家', '吉野家', '松屋', '富士そば', '日高屋', 'なか卯', 'てんや',
      'ガスト', 'デニーズ', 'サイゼリヤ', 'ジョナサン', 'バーミヤン', 'ドトール',
      'スターバックス', 'スタバ', 'タリーズ', 'コメダ', 'エクセルシオール',
      'セブン-イレブン', 'セブンイレブン', 'ローソン', 'ファミリーマート', 'ファミマ', 'ミニストップ',
      'イオン', '西友', 'マルエツ', 'ライフ', 'サミット', 'ヨークマート', 'コープ', '成城石井',
      '業務スーパー', 'オーケー', 'ビッグエー', '東急ストア',
      '食料', '食品', 'フード', 'レストラン', '居酒屋', '焼肉', '寿司', 'ラーメン', 'カフェ',
      'カフェテリア', '弁当', 'デリバリー', 'Uber Eats', 'UberEats', 'menu', 'Wolt',
      'ピザ', 'ドミノ', '餃子の王将', '大戸屋', '丸亀製麺', 'はなまる',
    ],
  },
  {
    category: '消・生活費',
    keywords: [
      'マツモトキヨシ', 'マツキヨ', 'ウェルシア', 'ツルハ', 'ドラッグストア', 'サンドラッグ',
      'コクミン', 'クスリのアオキ', 'ゲンキー',
      '電気', 'ガス', '水道', '電力', 'TEPCO', '東京ガス', '大阪ガス',
      'NHK', 'NTT', 'ドコモ', 'au', 'ソフトバンク', '楽天モバイル',
      '家賃', '管理費', '光熱費', '通信', 'インターネット',
      'ニトリ', 'IKEA', 'ホームセンター', 'コーナン', 'カインズ', 'ケーヨーデイツー',
      '日用品', '洗剤', 'ティッシュ', 'トイレットペーパー',
      'Amazon', 'ヨドバシ', 'ビックカメラ', 'エディオン', 'ケーズデンキ',
    ],
  },
  {
    category: '消・交通',
    keywords: [
      'Suica', 'PASMO', 'ICoca', 'TOICA', '交通系IC',
      '電車', 'JR', '東京メトロ', '都営', '阪急', '阪神', '近鉄', '南海', '京阪',
      'バス', 'タクシー', 'Uber', 'GO', 'DiDi', 'S.RIDE',
      '新幹線', '飛行機', 'JAL', 'ANA', 'スカイマーク', 'ピーチ', 'ジェットスター',
      '駐車場', 'コインパーキング', 'タイムズ', 'リパーク', 'ナビパーク',
      'ガソリン', 'エネオス', 'ENEOS', 'Shell', 'コスモ石油',
      'ETC', '高速道路', 'NEXCO',
      '自転車', '駐輪場', 'シェアサイクル', 'ドコモバイク', 'HELLO CYCLING',
    ],
  },
  {
    category: '浪・遊び／娯楽',
    keywords: [
      'Netflix', 'Hulu', 'Disney', 'Amazon Prime', 'U-NEXT', 'dTV', 'Apple TV',
      'Spotify', 'Apple Music', 'YouTube Premium', 'AWA',
      'カラオケ', 'ジョイサウンド', 'ビッグエコー',
      '映画', 'TOHOシネマ', 'イオンシネマ', 'ユナイテッドシネマ',
      'ゲーム', 'Steam', 'Nintendo', 'PlayStation', 'Xbox',
      'ボウリング', 'ゴルフ', 'テニス', 'ジム', 'スポーツ',
      '遊園地', 'テーマパーク', 'ディズニー', 'USJ', 'ユニバーサル',
      'マンガ', 'コミック', 'ゲームセンター', 'アミューズメント',
      '旅行', 'ホテル', '宿泊', 'じゃらん', '楽天トラベル',
      'キャンプ', 'アウトドア', 'パチンコ', 'スロット',
    ],
  },
  {
    category: '浪・ファッション／美容',
    keywords: [
      'ユニクロ', 'GU', 'H&M', 'ZARA', 'ザラ', 'Forever21',
      'BEAMS', 'Urban Research', 'アーバンリサーチ', 'nano・universe', 'SHIPS',
      '洋服の青山', 'スーツセレクト', 'AOKI', '青山', 'コナカ',
      'SHEIN', 'Rakuten Fashion', '楽天ファッション',
      'ABC-MART', 'ABCマート', 'ナイキ', 'アディダス', 'Nike', 'Adidas',
      'アクセサリー', 'ジュエリー', '時計', 'バッグ',
      '美容院', '理髪店', 'ヘアサロン', 'ネイル', 'まつ毛',
      'コスメ', '化粧品', 'DHC', '資生堂', 'カネボウ',
    ],
  },
  {
    category: '投・自己投資',
    keywords: [
      '本', '書籍', 'Amazon Kindle', 'Kindle', '電子書籍',
      '紀伊國屋', 'ジュンク堂', '丸善', 'TSUTAYA', 'ブックオフ',
      'Udemy', 'Coursera', 'スクール', 'セミナー', '講座', '研修',
      'オンライン学習', 'StudyHacker',
      '資格', '検定', 'TOEIC', '英会話', 'Duolingo',
      'YouTube Premium',
    ],
  },
  {
    category: '投・全般資産',
    keywords: [
      '証券', '株', '投資信託', 'SBI', '楽天証券', 'マネックス',
      '保険', '生命保険', '損害保険', '医療保険',
      '積立', 'NISA', 'iDeCo', 'ふるさと納税',
      '不動産', '家賃収入',
    ],
  },
]

const DEFAULT_CATEGORY = '他・特別費'

export const ALL_CATEGORIES = [
  '消・食費',
  '消・生活費',
  '消・交通',
  '家賃',
  '浪・遊び／娯楽',
  '浪・ファッション／美容',
  '浪・土産',
  '浪・旅',
  '投・自己投資',
  '投・全般資産',
  'home',
  '他・特別費',
  '妊活',
  '収入・相殺',
  'ポイント',
  '対象外',
]
export function categorize(description) {
  if (!description) return DEFAULT_CATEGORY
  const lower = description.toLowerCase()

  // カスタムルール優先（localStorage）
  const custom = loadCustomRules()
  for (const [kw, cat] of Object.entries(custom)) {
    if (lower.includes(kw.toLowerCase())) return cat
  }

  for (const rule of CATEGORY_RULES) {
    for (const keyword of rule.keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        return rule.category
      }
    }
  }
  return DEFAULT_CATEGORY
}
