const { loadState, updateState } = require('../../services/store');
const kitchenService = require('../../services/kitchen');

Page({
  data: { state: {}, meInitial: '我', partnerInitial: '她', showCreate: false, joinCode: '', showWechatProfile: false, draftAvatarUrl: '', draftNickname: '' },
  onLoad(options) { if (options.invite) this.setData({ joinCode: options.invite.toUpperCase() }); },
  onShow() { this.refresh(); },
  refresh() {
    const state = loadState();
    this.setData({
      state,
      meInitial: state.profile.meName.charAt(0) || '我',
      partnerInitial: state.profile.partnerName.charAt(0) || '她'
    });
  },
  async loginWechat() {
    try {
      await kitchenService.bindIdentity();
      this.refresh();
      this.openWechatProfile();
      wx.showToast({ title: '微信登录成功', icon: 'success' });
    }
    catch (error) { wx.showToast({ title: error.message || '登录失败，请稍后再试', icon: 'none' }); }
  },
  openWechatProfile() {
    const identity = this.data.state.identity;
    this.setData({
      showWechatProfile: true,
      draftAvatarUrl: identity.avatarUrl || '',
      draftNickname: identity.profileComplete ? identity.nickname : ''
    });
  },
  closeWechatProfile() { this.setData({ showWechatProfile: false }); },
  noop() {},
  onChooseAvatar(event) {
    const tempFilePath = event.detail.avatarUrl;
    wx.saveFile({
      tempFilePath,
      success: result => this.setData({ draftAvatarUrl: result.savedFilePath }),
      fail: () => this.setData({ draftAvatarUrl: tempFilePath })
    });
  },
  onNicknameInput(event) { this.setData({ draftNickname: event.detail.value }); },
  saveWechatProfile() {
    const nickname = this.data.draftNickname.trim();
    if (!this.data.draftAvatarUrl) return wx.showToast({ title: '请选择微信头像', icon: 'none' });
    if (!nickname) return wx.showToast({ title: '请选择微信昵称', icon: 'none' });
    updateState(state => {
      state.identity.avatarUrl = this.data.draftAvatarUrl;
      state.identity.nickname = nickname;
      state.identity.profileComplete = true;
      state.profile.meName = nickname;
    });
    this.setData({ showWechatProfile: false });
    this.refresh();
    wx.showToast({ title: '微信资料已保存', icon: 'success' });
  },
  toggleCreate() {
    if (!this.data.state.identity.bound) return wx.showToast({ title: '请先微信登录', icon: 'none' });
    this.setData({ showCreate: !this.data.showCreate });
  },
  async createKitchen(event) {
    const name = event.detail.value.name.trim();
    if (!name) return wx.showToast({ title: '先给厨房起名', icon: 'none' });
    try { await kitchenService.createKitchen(name); this.setData({ showCreate: false }); this.refresh(); wx.showToast({ title: '厨房建好了', icon: 'success' }); }
    catch (error) { wx.showToast({ title: '创建失败，请稍后重试', icon: 'none' }); }
  },
  onJoinCode(event) { this.setData({ joinCode: event.detail.value.toUpperCase() }); },
  async joinKitchen() {
    if (!this.data.state.identity.bound) return wx.showToast({ title: '请先微信登录', icon: 'none' });
    if (this.data.joinCode.length !== 6) return wx.showToast({ title: '请输入6位邀请码', icon: 'none' });
    try { await kitchenService.joinKitchen(this.data.joinCode); this.refresh(); wx.showToast({ title: '已加入厨房', icon: 'success' }); }
    catch (error) { wx.showToast({ title: '邀请码无效或已过期', icon: 'none' }); }
  },
  copyInvite() { wx.setClipboardData({ data: this.data.state.kitchen.inviteCode }); },
  saveProfile(event) {
    const values = event.detail.value;
    updateState(state => { state.profile = { ...state.profile, ...values }; });
    this.refresh(); wx.showToast({ title: '身份信息已保存', icon: 'success' });
  },
  addCategory(event) {
    const category = event.detail.value.category.trim();
    if (!category) return;
    if (this.data.state.categories.includes(category)) return wx.showToast({ title: '这个分类已经有了', icon: 'none' });
    updateState(state => state.categories.push(category)); this.refresh();
  },
  removeCategory(event) {
    const category = event.currentTarget.dataset.category;
    if (this.data.state.dishes.some(dish => dish.category === category)) return wx.showToast({ title: '先修改使用这个分类的菜', icon: 'none' });
    updateState(state => { state.categories = state.categories.filter(item => item !== category); }); this.refresh();
  },
  onShareAppMessage() {
    const kitchen = this.data.state.kitchen;
    return { title: `${this.data.state.profile.meName}邀请你加入「${kitchen.name}」`, path: `/pages/profile/profile?invite=${kitchen.inviteCode}` };
  }
});
