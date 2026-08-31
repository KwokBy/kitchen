const { loadState, updateState } = require('../../services/store');
const { formatDate } = require('../../utils/date');

Page({
  data: { dishes: [], history: [], dateText: '' },
  onShow() {
    const state = loadState();
    const today = formatDate(new Date());
    const dishes = state.dishes.filter(dish => dish.planDate === today);
    this.setData({
      dishes,
      history: state.history.slice(0, 4).map(item => ({ ...item, dish: state.dishes.find(dish => dish.id === item.dishId) })).filter(item => item.dish),
      dateText: new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())
    });
  },
  goMenu() { wx.switchTab({ url: '/pages/menu/menu' }); },
  startMeal() {
    if (!this.data.dishes.length) {
      wx.showToast({ title: '先安排今天的菜', icon: 'none' });
      return;
    }
    const now = new Date().toISOString();
    updateState(state => {
      this.data.dishes.forEach(dish => state.history.unshift({ id: `h-${Date.now()}-${dish.id}`, dishId: dish.id, at: now }));
    });
    wx.showToast({ title: '开饭啦', icon: 'success' });
    this.onShow();
  }
});
