Component({
  data: {
    selected: 0,
    hidden: false,
    items: [
      { path: '/pages/today/today', text: '首页', icon: '/assets/tabbar/today.png', activeIcon: '/assets/tabbar/today-active.png' },
      { path: '/pages/fridge/fridge', text: '冰箱', icon: '/assets/tabbar/fridge.png', activeIcon: '/assets/tabbar/fridge-active.png' },
      { path: '/pages/menu/menu', text: '菜单', icon: '/assets/tabbar/menu.png', activeIcon: '/assets/tabbar/menu-active.png' },
      { path: '/pages/profile/profile', text: '我的', icon: '/assets/tabbar/profile.png', activeIcon: '/assets/tabbar/profile-active.png' }
    ]
  },
  methods: {
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index);
      const path = this.data.items[index].path;
      this.setData({ selected: index });
      wx.switchTab({ url: path });
    }
  }
});
