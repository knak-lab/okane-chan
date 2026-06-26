export const BUCKET_CONFIG = [
  {
    name: '安心ライフ費',
    short: '安心',
    type: '消',
    categories: ['消・食費', '消・生活費', '消・交通'],
    budget: 150000,
    color: '#58a6ff',
  },
  {
    name: '暮らしの彩り費',
    short: '暮らし',
    type: '他',
    categories: ['他・特別費'],
    budget: 30000,
    color: '#bc8cff',
  },
  {
    name: 'ときめきチョイス費',
    short: 'ときめき',
    type: '浪',
    categories: ['浪・遊び／娯楽', '浪・ファッション'],
    budget: 50000,
    color: '#f0883e',
  },
  {
    name: '冒険予算',
    short: '冒険',
    type: '投',
    categories: ['投・自己投資', '投・全般資産'],
    budget: 80000,
    color: '#3fb950',
  },
]

export const TOTAL_BUDGET = BUCKET_CONFIG.reduce((sum, b) => sum + b.budget, 0)
