const { loadState, updateState } = require('../../services/store');
const { formatDate, addDays, dateChoices } = require('../../utils/date');
const { buildBasket } = require('../../utils/ingredients');

function status(expiryDate) {
  const today = new Date(`${formatDate(new Date())}T00:00:00`);
  const expiry = new Date(`${expiryDate}T00:00:00`);
  const days = Math.round((expiry - today) / 86400000);
  if (days < 0) return { text: `过期${Math.abs(days)}天`, tone: 'expired' };
  if (days <= 3) return { text: days === 0 ? '今天到期' : `${days}天后到期`, tone: 'soon' };
  return { text: `${days}天后`, tone: '' };
}

Page({
  data: { items: [], basketItems: [], missingCount: 0, attentionCount: 0, showEditor: false, defaultExpiry: '' },
  onShow() { if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({ selected: 1 }); this.refresh(); },
  refresh() {
    const state = loadState();
    const items = state.inventory.map(item => ({ ...item, status: status(item.expiryDate) })).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    const attentionCount = items.filter(item => item.status.tone === 'soon' || item.status.tone === 'expired').length;
    const plannedDates = new Set(dateChoices().map(item => item.value));
    const activeInventory = items.filter(item => item.status.tone !== 'expired');
    const plannedDishes = state.dishes.filter(dish => plannedDates.has(dish.planDate));
    const basketItems = buildBasket(plannedDishes, activeInventory);
    const missingCount = basketItems.filter(item => item.tone !== 'enough').length;
    this.setData({ items, basketItems, missingCount, attentionCount, defaultExpiry: formatDate(addDays(new Date(), 3)) });
  },
  openEditor() { this.setData({ showEditor: true }); },
  closeEditor() { this.setData({ showEditor: false }); },
  noop() {},
  onExpiryChange(event) { this.setData({ defaultExpiry: event.detail.value }); },
  addStock(event) {
    const { name, quantity, expiryDate } = event.detail.value;
    if (!name.trim() || !quantity.trim() || !expiryDate) {
      wx.showToast({ title: '把存货信息填完整', icon: 'none' });
      return;
    }
    updateState(state => state.inventory.push({ id: `s-${Date.now()}`, name: name.trim(), quantity: quantity.trim(), expiryDate }));
    this.setData({ showEditor: false });
    this.refresh();
    wx.showToast({ title: '已放进冰箱', icon: 'success' });
  },
  removeStock(event) {
    const id = event.currentTarget.dataset.id;
    const item = this.data.items.find(entry => entry.id === id);
    wx.showModal({ title: `用完${item.name}了？`, content: '确认后会从冰箱库存移除。', success: ({ confirm }) => {
      if (!confirm) return;
      updateState(state => { state.inventory = state.inventory.filter(entry => entry.id !== id); });
      this.refresh();
    }});
  }
});
