const { loadState, updateState } = require('../../services/store');
const { dateChoices } = require('../../utils/date');
const { planDatesOf, isPlannedOn, addPlanDate, removePlanDate } = require('../../utils/schedule');

function withWishText(dish) {
  const me = dish.wantedBy.includes('me');
  const partner = dish.wantedBy.includes('partner');
  const wishText = me && partner ? '我和她都想吃' : me ? '我想吃' : '她想吃';
  const plate = dish.plate || 'sage';
  const planDates = planDatesOf(dish);
  return { ...dish, planDates, plate, plateImage: `/assets/plates/${plate}.png`, wishText };
}

Page({
  data: {
    dishes: [], selectedIndex: 0, selectedDish: null, weekDays: [], dateOptions: [],
    plannedCount: 0, showArrange: false, arrangeDate: '', showPicker: false,
    pickerMode: 'all', pickerDishes: [], pickerSelectedIds: [],
    pickerDate: '', showDay: false, activeDay: { label: '', value: '', dishes: [] },
    tableMotion: '', plateMotion: '', showAddChoice: false, addChoiceDate: '', menuTouchStartY: 0
  },
  onShow() {
    if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({ selected: 2, hidden: false });
    this.refresh();
    if (getApp().globalData.openWishPicker) {
      getApp().globalData.openWishPicker = false;
      this.openPicker();
    }
    if (getApp().globalData.openAddChoiceDate) {
      const addChoiceDate = getApp().globalData.openAddChoiceDate;
      getApp().globalData.openAddChoiceDate = '';
      this.setTabHidden(true);
      this.setData({ showAddChoice: true, addChoiceDate });
    }
  },
  refresh() {
    const state = loadState();
    const dishes = state.dishes.map(withWishText);
    const selectedIndex = Math.min(this.data.selectedIndex, Math.max(0, dishes.length - 1));
    const selectedDish = dishes[selectedIndex] || null;
    const dateOptions = dateChoices();
    const weekDays = dateOptions.map(day => ({ ...day, dateText: day.value.slice(5).replace('-', '/'), dishes: dishes.filter(dish => isPlannedOn(dish, day.value)) }));
    const plannedCount = dishes.filter(dish => dateOptions.some(day => isPlannedOn(dish, day.value))).length;
    this.setData({ dishes, selectedIndex, selectedDish, dateOptions, weekDays, plannedCount });
  },
  selectDish(event) {
    const selectedIndex = Number(event.currentTarget.dataset.index);
    this.animateSelection(selectedIndex);
  },
  animateSelection(selectedIndex) {
    if (selectedIndex === this.data.selectedIndex) return;
    const direction = selectedIndex > this.data.selectedIndex ? 'forward' : 'backward';
    clearTimeout(this.menuMotionTimer);
    this.setData({ tableMotion: '', plateMotion: '' }, () => {
      this.setData({
        selectedIndex,
        selectedDish: this.data.dishes[selectedIndex],
        tableMotion: `table-spin-${direction}`,
        plateMotion: `plate-enter-${direction}`
      });
      this.menuMotionTimer = setTimeout(() => this.setData({ tableMotion: '', plateMotion: '' }), 520);
    });
  },
  onMenuTouchStart(event) {
    const touch = event.touches && event.touches[0];
    if (touch) this.setData({ menuTouchStartY: touch.clientY });
  },
  onMenuTouchEnd(event) {
    const touch = event.changedTouches && event.changedTouches[0];
    if (!touch || this.data.dishes.length < 2) return;
    const distance = touch.clientY - this.data.menuTouchStartY;
    if (Math.abs(distance) < 45) return;
    const nextIndex = distance < 0
      ? Math.min(this.data.selectedIndex + 1, this.data.dishes.length - 1)
      : Math.max(this.data.selectedIndex - 1, 0);
    this.animateSelection(nextIndex);
  },
  onUnload() { clearTimeout(this.menuMotionTimer); this.setTabHidden(false); },
  setTabHidden(hidden) { if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({ hidden }); },
  addDish() { this.setTabHidden(true); this.setData({ showAddChoice: true, addChoiceDate: '' }); },
  chooseExistingDish() {
    const pickerDate = this.data.addChoiceDate || (this.data.dateOptions[0] && this.data.dateOptions[0].value) || '';
    this.setData({ showAddChoice: false, showPicker: true, pickerDate, pickerSelectedIds: [] });
    this.updatePicker('all');
  },
  createNewDish() {
    const planDate = this.data.addChoiceDate;
    this.closeSheets();
    wx.navigateTo({ url: `/pages/dish-edit/dish-edit${planDate ? `?planDate=${planDate}` : ''}` });
  },
  editDish() { if (this.data.selectedDish) wx.navigateTo({ url: `/pages/dish-edit/dish-edit?id=${this.data.selectedDish.id}` }); },
  arrangeDish() {
    if (!this.data.selectedDish) return;
    this.setTabHidden(true);
    this.setData({ showArrange: true, arrangeDate: this.data.dateOptions[0].value });
  },
  chooseArrangeDate(event) { this.setData({ arrangeDate: event.currentTarget.dataset.date }); },
  confirmArrange() {
    const selectedDish = this.data.selectedDish;
    updateState(state => { const dish = state.dishes.find(item => item.id === selectedDish.id); if (dish) addPlanDate(dish, this.data.arrangeDate); });
    const label = this.data.dateOptions.find(item => item.value === this.data.arrangeDate).label;
    this.closeSheets(); this.refresh(); wx.showToast({ title: `已安排${label}`, icon: 'success' });
  },
  openPicker() {
    const pickerDate = this.data.dateOptions[0] ? this.data.dateOptions[0].value : '';
    this.setTabHidden(true);
    this.setData({ showPicker: true, pickerDate, pickerSelectedIds: [] }); this.updatePicker('all');
  },
  changePickerMode(event) { this.updatePicker(event.currentTarget.dataset.mode); },
  updatePicker(pickerMode) {
    let pickerDishes = this.data.dishes;
    if (pickerMode === 'me') pickerDishes = pickerDishes.filter(dish => dish.wantedBy.includes('me'));
    if (pickerMode === 'both') pickerDishes = pickerDishes.filter(dish => dish.wantedBy.includes('me') && dish.wantedBy.includes('partner'));
    const selected = new Set(this.data.pickerSelectedIds);
    this.setData({ pickerMode, pickerDishes: pickerDishes.map(dish => ({ ...dish, isSelected: selected.has(dish.id) })) });
  },
  selectPickerDish(event) {
    const dishId = event.currentTarget.dataset.id;
    const pickerSelectedIds = this.data.pickerSelectedIds.includes(dishId)
      ? this.data.pickerSelectedIds.filter(id => id !== dishId)
      : [...this.data.pickerSelectedIds, dishId];
    const selected = new Set(pickerSelectedIds);
    this.setData({ pickerSelectedIds, pickerDishes: this.data.pickerDishes.map(dish => ({ ...dish, isSelected: selected.has(dish.id) })) });
  },
  choosePickerDate(event) { this.setData({ pickerDate: event.currentTarget.dataset.date }); },
  confirmPicker() {
    const selectedIds = new Set(this.data.pickerSelectedIds);
    if (!selectedIds.size) return;
    updateState(state => state.dishes.forEach(dish => { if (selectedIds.has(dish.id)) addPlanDate(dish, this.data.pickerDate); }));
    const count = selectedIds.size;
    this.closeSheets(); this.refresh(); wx.showToast({ title: `已安排${count}道菜`, icon: 'success' });
  },
  openDay(event) { this.setTabHidden(true); this.setData({ showDay: true, activeDay: this.data.weekDays.find(item => item.value === event.currentTarget.dataset.date) }); },
  editDayDish(event) { this.closeSheets(); wx.navigateTo({ url: `/pages/dish-edit/dish-edit?id=${event.currentTarget.dataset.id}` }); },
  unscheduleDish(event) {
    const dishId = event.currentTarget.dataset.id;
    updateState(state => { const dish = state.dishes.find(item => item.id === dishId); if (dish) removePlanDate(dish, this.data.activeDay.value); });
    this.setData({ activeDay: { ...this.data.activeDay, dishes: this.data.activeDay.dishes.filter(item => item.id !== dishId) } });
    this.refresh();
  },
  addDishToDay() { const date = this.data.activeDay.value; this.closeSheets(); this.setTabHidden(true); this.setData({ showAddChoice: true, addChoiceDate: date }); },
  openBasket() { wx.switchTab({ url: '/pages/fridge/fridge' }); },
  closeSheets() { this.setTabHidden(false); this.setData({ showArrange: false, showPicker: false, showDay: false, showAddChoice: false }); },
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
