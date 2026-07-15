export const BUCKET_CONFIG = [
  {
    name: '安心ライフ費',
    short: '安心',
    type: '消',
    categories: ['消・食費', '消・生活費', '消・交通'],
    budget: 150000,
    color: '#003087',
  },
  {
    name: '家賃',
    short: '家賃',
    type: '固',
    categories: ['家賃'],
    budget: 0,
    color: '#0EA5E9',
  },
  {
    name: '暮らしの彩り費',
    short: '暮らし',
    type: '他',
    categories: ['浪・遊び／娯楽'],
    budget: 30000,
    color: '#7C3AED',
  },
  {
    name: 'ときめきチョイス費',
    short: 'ときめき',
    type: '浪',
    categories: ['他・特別費', '浪・土産', 'home', '浪・ファッション／美容'],
    budget: 50000,
    color: '#F47920',
  },
  {
    name: '冒険予算',
    short: '冒険',
    type: '投',
    categories: ['浪・旅', '投・自己投資', '投・全般資産'],
    budget: 80000,
    color: '#059669',
  },
  {
    name: '妊活',
    short: '妊活',
    type: '特',
    categories: ['妊活'],
    budget: 0,
    color: '#EC4899',
  },
]

export const TOTAL_BUDGET = BUCKET_CONFIG.reduce((sum, b) => sum + b.budget, 0)

export const ANNUAL_BUCKET_NAMES = ['ときめきチョイス費', '冒険予算', '妊活']
