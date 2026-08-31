const { loadState, updateState } = require('../../services/store');
const { formatDate, addDays, dateChoices } = require('../../utils/date');
const { buildDailyBaskets } = require('../../utils/ingredients');

function status(expiryDate) {
  const today = new Date(`${formatDate(new Date())}T00:00:00`);
  const expiry = new Date(`${expiryDate}T00:00:00`);
  const days = Math.round((expiry - today) / 86400000);
  if (days < 0) return { text: `过期${Math.abs(days)}天`, tone: 'expired' };
  if (days <= 3) return { text: days === 0 ? '今天到期' : `${days}天后到期`, tone: 'soon' };
  return { text: `${days}天后`, tone: '' };
}

Page({
  data: { items: [], basketDays: [], missingCount: 0, attentionCount: 0, showEditor: false, editingStockId: '', stockName: '', stockQuantity: '', defaultExpiry: '' },
  onShow() { if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({ selected: 1, hidden: false }); this.refresh(); },
  refresh() {
    const state = loadState();
    const items = state.inventory.map(item => ({ ...item, status: status(item.expiryDate) })).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    const attentionCount = items.filter(item => item.status.tone === 'soon' || item.status.tone === 'expired').length;
    const activeInventory = items.filter(item => item.status.tone !== 'expired');
    const basketDays = buildDailyBaskets(state.dishes, activeInventory, dateChoices());
    const missingCount = basketDays.reduce((total, day) => total + day.missingCount, 0);
    this.setData({ items, basketDays, missingCount, attentionCount, defaultExpiry: this.data.showEditor ? this.data.defaultExpiry : formatDate(addDays(new Date(), 3)) });
  },
  setTabHidden(hidden) { if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({ hidden }); },
  openEditor() { this.setTabHidden(true); this.setData({ showEditor: true, editingStockId: '', stockName: '', stockQuantity: '', defaultExpiry: formatDate(addDays(new Date(), 3)) }); },
  editStock(event) {
    const item = this.data.items.find(entry => entry.id === event.currentTarget.dataset.id);
    if (!item) return;
    this.setTabHidden(true);
    this.setData({ showEditor: true, editingStockId: item.id, stockName: item.name, stockQuantity: item.quantity, defaultExpiry: item.expiryDate });
  },
  closeEditor() { this.setTabHidden(false); this.setData({ showEditor: false }); },
  onUnload() { this.setTabHidden(false); },
  noop() {},
  onExpiryChange(event) { this.setData({ defaultExpiry: event.detail.value }); },
  saveStock(event) {
    const { name, quantity, expiryDate } = event.detail.value;
    if (!name.trim() || !quantity.trim() || !expiryDate) {
      wx.showToast({ title: '把存货信息填完整', icon: 'none' });
      return;
    }
    updateState(state => {
      const stock = { id: this.data.editingStockId || `s-${Date.now()}`, name: name.trim(), quantity: quantity.trim(), expiryDate };
      const index = state.inventory.findIndex(item => item.id === stock.id);
      if (index >= 0) state.inventory[index] = stock;
      else state.inventory.push(stock);
    });
    this.setTabHidden(false);
    this.setData({ showEditor: false });
    this.refresh();
    wx.showToast({ title: this.data.editingStockId ? '存货已更新' : '已放进冰箱', icon: 'success' });
  },
  removeStock(event) {
    const id = event.currentTarget.dataset.id || this.data.editingStockId;
    const item = this.data.items.find(entry => entry.id === id);
    wx.showModal({ title: `用完${item.name}了？`, content: '确认后会从冰箱库存移除。', success: ({ confirm }) => {
      if (!confirm) return;
      updateState(state => { state.inventory = state.inventory.filter(entry => entry.id !== id); });
      this.setTabHidden(false);
      this.setData({ showEditor: false });
      this.refresh();
    }});
  },
  copyIngredient(event) {
    wx.setClipboardData({ data: event.currentTarget.dataset.name });
  },
  copyShoppingList() {
    const lines = this.data.basketDays.flatMap(day => day.ingredients.filter(item => item.tone !== 'enough').map(item => `${day.label}｜${item.name}｜${item.missingText}`));
    if (!lines.length) return wx.showToast({ title: '暂时不缺食材', icon: 'none' });
    wx.setClipboardData({ data: lines.join('\n'), success: () => wx.showModal({ title: '采购清单已复制', content: '打开小象超市后，可粘贴食材名称逐项搜索。', showCancel: false }) });
  }
});
