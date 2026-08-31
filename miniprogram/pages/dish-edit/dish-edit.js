const { loadState, updateState } = require('../../services/store');
const { formatDate } = require('../../utils/date');

Page({
  data: {
    dishId: '',
    title: '新增一道菜',
    categories: [],
    categoryIndex: 0,
    name: '',
    image: '/assets/dishes/dish-1.png',
    wantedBy: ['partner'],
    meWanted: false,
    partnerWanted: true,
    today: '',
    planDate: '',
    note: '',
    ingredientsText: ''
  },
  onLoad(options) {
    const state = loadState();
    const dish = options.id ? state.dishes.find(item => item.id === options.id) : null;
    const categoryIndex = dish ? Math.max(0, state.categories.indexOf(dish.category)) : 0;
    this.setData({
      dishId: dish ? dish.id : '',
      title: dish ? '编辑这道菜' : '新增一道菜',
      categories: state.categories,
      categoryIndex,
      name: dish ? dish.name : '',
      image: dish ? dish.image : '/assets/dishes/dish-1.png',
      wantedBy: dish ? dish.wantedBy : ['partner'],
      meWanted: dish ? dish.wantedBy.includes('me') : false,
      partnerWanted: dish ? dish.wantedBy.includes('partner') : true,
      today: formatDate(new Date()),
      planDate: dish ? dish.planDate : (options.planDate || ''),
      note: dish ? dish.note : '',
      ingredientsText: dish ? dish.ingredients.join('\n') : ''
    });
    wx.setNavigationBarTitle({ title: this.data.title });
  },
  onCategoryChange(event) { this.setData({ categoryIndex: Number(event.detail.value) }); },
  onPlanDateChange(event) { this.setData({ planDate: event.detail.value }); },
  clearPlanDate() { this.setData({ planDate: '' }); },
  toggleWanted(event) {
    const person = event.currentTarget.dataset.person;
    const wantedBy = this.data.wantedBy.includes(person)
      ? this.data.wantedBy.filter(item => item !== person)
      : [...this.data.wantedBy, person];
    this.setData({ wantedBy, meWanted: wantedBy.includes('me'), partnerWanted: wantedBy.includes('partner') });
  },
  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: result => this.setData({ image: result.tempFiles[0].tempFilePath })
    });
  },
  saveDish(event) {
    const values = event.detail.value;
    const name = values.name.trim();
    if (!name) return wx.showToast({ title: '先写菜名', icon: 'none' });
    if (!this.data.wantedBy.length) return wx.showToast({ title: '至少标记一个人想吃', icon: 'none' });
    const dish = {
      id: this.data.dishId || `d-${Date.now()}`,
      name,
      category: this.data.categories[this.data.categoryIndex],
      wantedBy: this.data.wantedBy,
      image: this.data.image,
      note: values.note.trim(),
      planDate: this.data.planDate,
      ingredients: values.ingredients.split('\n').map(item => item.trim()).filter(Boolean)
    };
    updateState(state => {
      const index = state.dishes.findIndex(item => item.id === dish.id);
      if (index >= 0) state.dishes[index] = dish;
      else state.dishes.push(dish);
    });
    wx.showToast({ title: this.data.dishId ? '菜已更新' : '菜已添加', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 350);
  }
});
