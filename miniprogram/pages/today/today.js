const { loadState, updateState } = require('../../services/store');
const { formatDate, addDays } = require('../../utils/date');
const { consumeInventory } = require('../../utils/ingredients');

function withPlate(dish) {
  const plate = dish.plate || 'sage';
  return { ...dish, plate, plateImage: `/assets/plates/${plate}.png` };
}

Page({
  data: { dishes: [], tomorrowDishes: [], missedDishes: [], todayDate: '', tomorrowDate: '', history: [], dateText: '' },
  onShow() {
    if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({ selected: 0 });
    const state = loadState();
    const today = formatDate(new Date());
    const tomorrowDate = formatDate(addDays(new Date(), 1));
    const dishes = state.dishes.filter(dish => dish.planDate === today).map(withPlate);
    const tomorrowDishes = state.dishes.filter(dish => dish.planDate === tomorrowDate).map(withPlate);
    const missedDishes = state.dishes.filter(dish => dish.planDate && dish.planDate < today).map(withPlate);
    this.setData({
      dishes,
      tomorrowDishes,
      missedDishes,
      todayDate: today,
      tomorrowDate,
      history: state.history.slice(0, 4).map(item => ({ ...item, dish: state.dishes.find(dish => dish.id === item.dishId) })).filter(item => item.dish).map(item => ({ ...item, dish: withPlate(item.dish) })),
      dateText: new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())
    });
  },
  goMenu() {
    getApp().globalData.openWishPicker = true;
    wx.switchTab({ url: '/pages/menu/menu' });
  },
  goHistory() { wx.pageScrollTo({ selector: '#meal-history', duration: 280 }); },
  addTomorrowDish() {
    getApp().globalData.openAddChoiceDate = this.data.tomorrowDate;
    wx.switchTab({ url: '/pages/menu/menu' });
  },
  surpriseTomorrow() {
    const state = loadState();
    const candidates = state.dishes.filter(dish => !dish.planDate);
    if (!candidates.length) return wx.showToast({ title: '菜库里还没有可安排的菜', icon: 'none' });
    const choice = candidates[Math.floor(Math.random() * candidates.length)];
    updateState(next => { const dish = next.dishes.find(item => item.id === choice.id); if (dish) dish.planDate = this.data.tomorrowDate; });
    this.onShow();
    wx.showToast({ title: `明天吃${choice.name}`, icon: 'none' });
  },
  startMeal() {
    if (!this.data.dishes.length) {
      wx.showToast({ title: '先安排今天的菜', icon: 'none' });
      return;
    }
    wx.showModal({ title: '这些菜都做完了吗？', content: '确认后会记录这顿饭，并按菜谱用量扣减冰箱食材。', confirmText: '做完了', success: ({ confirm }) => {
      if (!confirm) return;
      const now = new Date().toISOString();
      updateState(state => {
        const result = consumeInventory(state.inventory, this.data.dishes, { usableOn: this.data.todayDate });
        state.inventory = result.inventory;
        this.data.dishes.forEach(dish => {
          state.history.unshift({ id: `h-${Date.now()}-${dish.id}`, dishId: dish.id, at: now });
          const storedDish = state.dishes.find(item => item.id === dish.id);
          if (storedDish) storedDish.planDate = '';
        });
      });
      wx.showToast({ title: '已记录并更新冰箱', icon: 'success' });
      this.onShow();
    }});
  },
  moveMissedToToday(event) {
    const id = event.currentTarget.dataset.id;
    updateState(state => { const dish = state.dishes.find(item => item.id === id); if (dish) dish.planDate = this.data.todayDate; });
    this.onShow();
    wx.showToast({ title: '已改到今天', icon: 'success' });
  },
  clearMissed(event) {
    const id = event.currentTarget.dataset.id;
    updateState(state => { const dish = state.dishes.find(item => item.id === id); if (dish) dish.planDate = ''; });
    this.onShow();
  }
});
