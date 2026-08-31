const { loadState, updateState } = require('../../services/store');
const { dateChoices } = require('../../utils/date');

function withWishText(dish) {
  const me = dish.wantedBy.includes('me');
  const partner = dish.wantedBy.includes('partner');
  const wishText = me && partner ? '我和她都想吃' : me ? '我想吃' : '她想吃';
  return { ...dish, wishText };
}

Page({
  data: { dishes: [], selectedIndex: 0, selectedDish: null, weekDays: [] },
  onShow() { this.refresh(); },
  refresh() {
    const state = loadState();
    const dishes = state.dishes.map(withWishText);
    const selectedIndex = Math.min(this.data.selectedIndex, Math.max(0, state.dishes.length - 1));
    const selectedDish = dishes[selectedIndex] || null;
    const weekDays = dateChoices().map(day => ({ ...day, dishes: dishes.filter(dish => dish.planDate === day.value) }));
    this.setData({ dishes, selectedIndex, selectedDish, weekDays });
  },
  selectDish(event) {
    const selectedIndex = Number(event.currentTarget.dataset.index);
    this.setData({ selectedIndex, selectedDish: this.data.dishes[selectedIndex] });
  },
  addDish() { wx.navigateTo({ url: '/pages/dish-edit/dish-edit' }); },
  editDish() {
    if (this.data.selectedDish) wx.navigateTo({ url: `/pages/dish-edit/dish-edit?id=${this.data.selectedDish.id}` });
  },
  arrangeDish() {
    if (!this.data.selectedDish) return;
    const choices = dateChoices();
    wx.showActionSheet({
      itemList: choices.map(item => item.label),
      success: ({ tapIndex }) => {
        const choice = choices[tapIndex];
        updateState(state => {
          const dish = state.dishes.find(item => item.id === this.data.selectedDish.id);
          if (dish) dish.planDate = choice.value;
        });
        wx.showToast({ title: `已安排${choice.label}`, icon: 'success' });
        this.refresh();
      }
    });
  },
  openDay(event) {
    const date = event.currentTarget.dataset.date;
    const day = this.data.weekDays.find(item => item.value === date);
    const choices = day.dishes.length ? day.dishes : this.data.dishes;
    if (!choices.length) return this.addDish();
    wx.showActionSheet({
      itemList: choices.map(item => day.dishes.length ? `${item.name} · ${item.wishText}` : `安排 ${item.name}`),
      success: ({ tapIndex }) => {
        const dish = choices[tapIndex];
        const selectedIndex = this.data.dishes.findIndex(item => item.id === dish.id);
        if (day.dishes.length) {
          this.setData({ selectedIndex, selectedDish: this.data.dishes[selectedIndex] });
          return;
        }
        updateState(state => {
          const storedDish = state.dishes.find(item => item.id === dish.id);
          if (storedDish) storedDish.planDate = date;
        });
        this.setData({ selectedIndex });
        this.refresh();
      }
    });
  },
  removeDish() {
    if (!this.data.selectedDish) return;
    wx.showModal({
      title: '移出这道菜？',
      content: '移出后不会保留在菜库中。',
      confirmColor: '#D85D3F',
      success: ({ confirm }) => {
        if (!confirm) return;
        updateState(state => { state.dishes = state.dishes.filter(item => item.id !== this.data.selectedDish.id); });
        this.setData({ selectedIndex: 0 });
        this.refresh();
      }
    });
  }
});
