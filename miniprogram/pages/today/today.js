const { loadState, updateState } = require('../../services/store');
const { formatDate, addDays } = require('../../utils/date');
const { consumeInventory } = require('../../utils/ingredients');
const { planDatesOf, isPlannedOn, addPlanDate, removePlanDate } = require('../../utils/schedule');
const notificationsService = require('../../services/notifications');

function withPlate(dish) {
  const plate = dish.plate || 'sage';
  return { ...dish, plate, plateImage: `/assets/plates/${plate}.png` };
}

Page({
  data: { dishes: [], tomorrowDishes: [], missedDishes: [], todayDate: '', tomorrowDate: '', history: [], dateText: '', notifications: [], unreadCount: 0, showNotifications: false, canRemindPicker: false, pickerRoleName: '点菜主力' },
  onShow() {
    if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({ selected: 0 });
    const state = loadState();
    const today = formatDate(new Date());
    const tomorrowDate = formatDate(addDays(new Date(), 1));
    const dishes = state.dishes.filter(dish => isPlannedOn(dish, today)).map(withPlate);
    const tomorrowDishes = state.dishes.filter(dish => isPlannedOn(dish, tomorrowDate)).map(withPlate);
    const missedDishes = state.dishes.flatMap(dish => planDatesOf(dish)
      .filter(planDate => planDate < today)
      .map(planDate => ({ ...withPlate(dish), planDate, occurrenceId: `${dish.id}-${planDate}` })));
    this.setData({
      dishes,
      tomorrowDishes,
      missedDishes,
      todayDate: today,
      tomorrowDate,
      history: state.history.slice(0, 4).map(item => ({ ...item, dish: state.dishes.find(dish => dish.id === item.dishId) })).filter(item => item.dish).map(item => ({ ...item, dish: withPlate(item.dish) })),
      dateText: new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date()),
      canRemindPicker: !!state.kitchen && state.kitchen.role === 'owner' && state.kitchen.memberCount >= 2,
      pickerRoleName: state.kitchen && state.kitchen.memberRoleName ? state.kitchen.memberRoleName : '点菜主力'
    });
    this.refreshNotifications();
  },
  async refreshNotifications() {
    try {
      const response = await notificationsService.list();
      const notifications = response.notifications.map(item => {
        const dateText = item.date ? item.date.slice(5).replace('-', '/') : '';
        return {
          ...item,
          title: item.kind === 'menu_ready' ? `${item.senderNickname || '搭档'}点好菜单了` : `${item.senderNickname || '搭档'}提醒你来点菜`,
          body: item.kind === 'menu_ready' ? `${dateText} · ${item.dishNames.join('、')}` : `打开菜单，挑几道想吃的吧`,
          timeText: item.createdAt ? item.createdAt.slice(5, 16).replace('T', ' ') : ''
        };
      });
      this.setData({ notifications, unreadCount: response.unreadCount });
    } catch (_) {}
  },
  setTabHidden(hidden) { if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({ hidden }); },
  async openNotifications() {
    this.setTabHidden(true);
    this.setData({ showNotifications: true });
    if (this.data.unreadCount) {
      try { await notificationsService.markAllRead(); this.setData({ unreadCount: 0, notifications: this.data.notifications.map(item => ({ ...item, isRead: true })) }); } catch (_) {}
    }
  },
  closeNotifications() { this.setTabHidden(false); this.setData({ showNotifications: false }); },
  noop() {},
  onUnload() { this.setTabHidden(false); },
  async remindPicker() {
    try {
      await notificationsService.remindPicker();
      wx.showToast({ title: `已提醒${this.data.pickerRoleName}`, icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '提醒发送失败', icon: 'none' });
    }
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
    const candidates = state.dishes.filter(dish => !isPlannedOn(dish, this.data.tomorrowDate));
    if (!candidates.length) return wx.showToast({ title: '菜库里还没有可安排的菜', icon: 'none' });
    const choice = candidates[Math.floor(Math.random() * candidates.length)];
    updateState(next => { const dish = next.dishes.find(item => item.id === choice.id); if (dish) addPlanDate(dish, this.data.tomorrowDate); });
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
          if (storedDish) removePlanDate(storedDish, this.data.todayDate);
        });
      });
      wx.showToast({ title: '已记录并更新冰箱', icon: 'success' });
      this.onShow();
    }});
  },
  moveMissedToToday(event) {
    const id = event.currentTarget.dataset.id;
    const date = event.currentTarget.dataset.date;
    updateState(state => {
      const dish = state.dishes.find(item => item.id === id);
      if (dish) { removePlanDate(dish, date); addPlanDate(dish, this.data.todayDate); }
    });
    this.onShow();
    wx.showToast({ title: '已改到今天', icon: 'success' });
  },
  clearMissed(event) {
    const id = event.currentTarget.dataset.id;
    const date = event.currentTarget.dataset.date;
    updateState(state => { const dish = state.dishes.find(item => item.id === id); if (dish) removePlanDate(dish, date); });
    this.onShow();
  }
});
