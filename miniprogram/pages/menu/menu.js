const { loadState, updateState } = require('../../services/store');
const { dateChoices } = require('../../utils/date');

function withWishText(dish) {
  const me = dish.wantedBy.includes('me');
  const partner = dish.wantedBy.includes('partner');
  const wishText = me && partner ? '我和她都想吃' : me ? '我想吃' : '她想吃';
  return { ...dish, plate: dish.plate || 'sage', wishText };
}

Page({
  data: {
    dishes: [], selectedIndex: 0, selectedDish: null, weekDays: [], dateOptions: [],
    plannedCount: 0, showArrange: false, arrangeDate: '', showPicker: false,
    pickerMode: 'all', pickerDishes: [], pickerIndex: 0, pickerDish: null,
    pickerDate: '', showDay: false, activeDay: { label: '', value: '', dishes: [] }
  },
  onShow() {
    this.refresh();
    if (getApp().globalData.openWishPicker) {
      getApp().globalData.openWishPicker = false;
      this.openPicker();
    }
  },
  refresh() {
    const state = loadState();
    const dishes = state.dishes.map(withWishText);
    const selectedIndex = Math.min(this.data.selectedIndex, Math.max(0, dishes.length - 1));
    const selectedDish = dishes[selectedIndex] || null;
    const dateOptions = dateChoices();
    const weekDays = dateOptions.map(day => ({ ...day, dateText: day.value.slice(5).replace('-', '/'), dishes: dishes.filter(dish => dish.planDate === day.value) }));
    const plannedCount = dishes.filter(dish => dateOptions.some(day => day.value === dish.planDate)).length;
    this.setData({ dishes, selectedIndex, selectedDish, dateOptions, weekDays, plannedCount });
  },
  selectDish(event) {
    const selectedIndex = Number(event.currentTarget.dataset.index);
    this.setData({ selectedIndex, selectedDish: this.data.dishes[selectedIndex] });
  },
  addDish() { wx.navigateTo({ url: '/pages/dish-edit/dish-edit' }); },
  editDish() { if (this.data.selectedDish) wx.navigateTo({ url: `/pages/dish-edit/dish-edit?id=${this.data.selectedDish.id}` }); },
  arrangeDish() {
    if (!this.data.selectedDish) return;
    this.setData({ showArrange: true, arrangeDate: this.data.selectedDish.planDate || this.data.dateOptions[0].value });
  },
  chooseArrangeDate(event) { this.setData({ arrangeDate: event.currentTarget.dataset.date }); },
  confirmArrange() {
    const selectedDish = this.data.selectedDish;
    updateState(state => { const dish = state.dishes.find(item => item.id === selectedDish.id); if (dish) dish.planDate = this.data.arrangeDate; });
    const label = this.data.dateOptions.find(item => item.value === this.data.arrangeDate).label;
    this.closeSheets(); this.refresh(); wx.showToast({ title: `已安排${label}`, icon: 'success' });
  },
  openPicker() {
    const pickerDate = this.data.dateOptions[0] ? this.data.dateOptions[0].value : '';
    this.setData({ showPicker: true, pickerDate }); this.updatePicker('all');
  },
  changePickerMode(event) { this.updatePicker(event.currentTarget.dataset.mode); },
  updatePicker(pickerMode) {
    let pickerDishes = this.data.dishes;
    if (pickerMode === 'me') pickerDishes = pickerDishes.filter(dish => dish.wantedBy.includes('me'));
    if (pickerMode === 'both') pickerDishes = pickerDishes.filter(dish => dish.wantedBy.includes('me') && dish.wantedBy.includes('partner'));
    this.setData({ pickerMode, pickerDishes, pickerIndex: 0, pickerDish: pickerDishes[0] || null });
  },
  selectPickerDish(event) {
    const pickerIndex = Number(event.currentTarget.dataset.index);
    this.setData({ pickerIndex, pickerDish: this.data.pickerDishes[pickerIndex] });
  },
  choosePickerDate(event) { this.setData({ pickerDate: event.currentTarget.dataset.date }); },
  confirmPicker() {
    if (!this.data.pickerDish) return;
    updateState(state => { const dish = state.dishes.find(item => item.id === this.data.pickerDish.id); if (dish) dish.planDate = this.data.pickerDate; });
    const name = this.data.pickerDish.name;
    this.closeSheets(); this.refresh(); wx.showToast({ title: `${name}已安排`, icon: 'success' });
  },
  openDay(event) { this.setData({ showDay: true, activeDay: this.data.weekDays.find(item => item.value === event.currentTarget.dataset.date) }); },
  editDayDish(event) { this.closeSheets(); wx.navigateTo({ url: `/pages/dish-edit/dish-edit?id=${event.currentTarget.dataset.id}` }); },
  unscheduleDish(event) {
    const dishId = event.currentTarget.dataset.id;
    updateState(state => { const dish = state.dishes.find(item => item.id === dishId); if (dish) dish.planDate = ''; });
    this.setData({ activeDay: { ...this.data.activeDay, dishes: this.data.activeDay.dishes.filter(item => item.id !== dishId) } });
    this.refresh();
  },
  addDishToDay() { const date = this.data.activeDay.value; this.closeSheets(); wx.navigateTo({ url: `/pages/dish-edit/dish-edit?planDate=${date}` }); },
  openBasket() { wx.switchTab({ url: '/pages/fridge/fridge' }); },
  closeSheets() { this.setData({ showArrange: false, showPicker: false, showDay: false }); },
  noop() {},
  removeDish() {
    if (!this.data.selectedDish) return;
    wx.showModal({ title: '移出这道菜？', content: '移出后不会保留在菜库中。', confirmColor: '#D85D3F', success: ({ confirm }) => {
      if (!confirm) return;
      updateState(state => { state.dishes = state.dishes.filter(item => item.id !== this.data.selectedDish.id); });
      this.setData({ selectedIndex: 0 }); this.refresh();
    }});
  }
});
