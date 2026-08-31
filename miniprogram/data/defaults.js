const { formatDate, addDays, dateChoices } = require('../utils/date');

function createDefaults() {
  const today = new Date();
  const choices = dateChoices();
  const saturday = choices.find(item => item.label === '周六');
  return {
    version: 2,
    profile: { homeName: '熹贵妃的小厨房', meName: '我', partnerName: '她', meRole: '做饭主力', partnerRole: '点菜主力' },
    identity: { bound: false, openid: '', nickname: '', avatarUrl: '', profileComplete: false },
    kitchen: null,
    categories: ['荤菜', '素菜', '汤羹', '小吃', '主食'],
    dishes: [
      { id: 'd1', name: '番茄炒蛋', category: '素菜', wantedBy: ['me', 'partner'], image: '/assets/dishes/dish-1.png', note: '多一点汁', planDate: formatDate(today), ingredients: ['番茄 3个', '鸡蛋 4个', '葱 1根'] },
      { id: 'd2', name: '红烧排骨', category: '荤菜', wantedBy: ['partner'], image: '/assets/dishes/dish-2.png', note: '周末慢慢炖', planDate: saturday ? saturday.value : '', ingredients: ['排骨 800克', '姜 1块'] },
      { id: 'd3', name: '干煸豆角', category: '素菜', wantedBy: ['partner'], image: '/assets/dishes/dish-3.png', note: '少辣', planDate: '', ingredients: ['豆角 500克', '蒜 3瓣'] },
      { id: 'd4', name: '麻婆豆腐', category: '荤菜', wantedBy: ['me', 'partner'], image: '/assets/dishes/dish-4.png', note: '配米饭', planDate: '', ingredients: ['豆腐 2盒', '肉末 150克'] },
      { id: 'd5', name: '清蒸鱼', category: '荤菜', wantedBy: ['partner'], image: '/assets/dishes/dish-5.png', note: '买到鲜鱼再做', planDate: '', ingredients: ['鲜鱼 1条', '姜 1块'] },
      { id: 'd6', name: '莲藕排骨汤', category: '汤羹', wantedBy: ['me'], image: '/assets/dishes/dish-6.png', note: '炖久一点', planDate: '', ingredients: ['莲藕 500克', '排骨 500克'] }
    ],
    inventory: [
      { id: 's1', name: '番茄', quantity: '2个', expiryDate: formatDate(addDays(today, 2)) },
      { id: 's2', name: '鸡蛋', quantity: '6个', expiryDate: formatDate(addDays(today, 12)) },
      { id: 's3', name: '葱', quantity: '3根', expiryDate: formatDate(addDays(today, 1)) }
    ],
    history: []
  };
}

module.exports = { createDefaults };
