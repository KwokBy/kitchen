const { loadState, updateState } = require('../../services/store');
const { formatDate, addDays } = require('../../utils/date');
const { consumeInventory } = require('../../utils/ingredients');
const { planDatesOf, isPlannedOn, addPlanDate, removePlanDate } = require('../../utils/schedule');
const notificationsService = require('../../services/notifications');
const kitchenService = require('../../services/kitchen');

function withPlate(dish) {
  const plate = dish.plate || 'sage';
  return { ...dish, plate, plateImage: `/assets/plates/${plate}.png` };
}

function dateLabel(date) {
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${date.getMonth() + 1}月${date.getDate()}日 星期${weekdays[date.getDay()]}`;
}

Page({
  data: { dishes: [], tomorrowDishes: [], missedDishes: [], todayDate: '', tomorrowDate: '', history: [], dateText: '', notifications: [], unreadCount: 0, showNotifications: false, canRemindPicker: false, canSubscribeWechat: false, reminderCaption: '厨房提醒', reminderTitle: '登录后和搭档互相提醒', reminderAction: '去登录 →', pickerRoleName: '点菜主力' },
  onShow() {
    if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({ selected: 0 });
    const state = loadState();
    this.renderState(state);
    this.refreshNotifications();
    this.syncKitchen(state);
  },
  renderState(state) {
    const now = new Date();
    const today = formatDate(now);
    const tomorrowDate = formatDate(addDays(now, 1));
    const dishes = state.dishes.filter(dish => isPlannedOn(dish, today)).map(withPlate);
    const tomorrowDishes = state.dishes.filter(dish => isPlannedOn(dish, tomorrowDate)).map(withPlate);
    const missedDishes = state.dishes.flatMap(dish => planDatesOf(dish)
      .filter(planDate => planDate < today)
      .map(planDate => ({ ...withPlate(dish), planDate, occurrenceId: `${dish.id}-${planDate}` })));
    const kitchen = state.kitchen;
    const isOwner = !!kitchen && kitchen.role === 'owner';
    const isMember = !!kitchen && kitchen.role === 'member';
    this.setData({
      dishes,
      tomorrowDishes,
      missedDishes,
      todayDate: today,
      tomorrowDate,
      history: state.history.slice(0, 4).map(item => ({ ...item, dish: state.dishes.find(dish => dish.id === item.dishId) })).filter(item => item.dish).map(item => ({ ...item, dish: withPlate(item.dish) })),
      dateText: dateLabel(now),
      canRemindPicker: isOwner,
      canSubscribeWechat: !!kitchen && state.identity.bound && getApp().globalData.backendMode === 'rust',
      reminderCaption: isOwner ? '还没想好吃什么？' : isMember ? '点好菜单后会自动通知' : state.identity.bound ? '还没有加入厨房' : '厨房提醒',
      reminderTitle: isOwner ? `提醒${kitchen.memberRoleName || '点菜主力'}来点菜` : isMember ? `通知${kitchen.ownerRoleName || '做饭主力'}准备做饭` : state.identity.bound ? '先创建或加入一个厨房' : '登录后和搭档互相提醒',
      reminderAction: isOwner ? '发送提醒 →' : isMember ? '去点菜 →' : '去我的 →',
      pickerRoleName: kitchen && kitchen.memberRoleName ? kitchen.memberRoleName : '点菜主力'
    });
  },
  async syncKitchen(state) {
    if (getApp().globalData.backendMode !== 'rust' || !state.identity.bound) return;
    try {
      await kitchenService.refreshKitchen();
      this.renderState(loadState());
    } catch (error) {
      console.warn('首页厨房同步失败，继续使用本地状态', error);
    }
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
      const result = await notificationsService.remindPicker();
      wx.showToast({ title: result.pushSent ? '微信提醒已发送' : '已发到厨房消息', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '提醒发送失败', icon: 'none' });
    }
  },
  handleReminder() {
    if (this.data.canRemindPicker) return this.remindPicker();
    const state = loadState();
    if (!state.identity.bound || !state.kitchen) return wx.switchTab({ url: '/pages/profile/profile' });
    this.goMenu();
  },
  async subscribeWechat() {
    const state = loadState();
    if (!this.data.canSubscribeWechat) {
      wx.showToast({ title: state.identity.bound ? '请先创建或加入厨房' : '请先微信登录', icon: 'none' });
      wx.switchTab({ url: '/pages/profile/profile' });
      return;
    }
    try {
      const accepted = await notificationsService.subscribeWechat();
      wx.showToast({ title: accepted ? '下一条微信提醒已开启' : '你暂未允许微信提醒', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: error.errMsg || '微信提醒开启失败', icon: 'none' });
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
