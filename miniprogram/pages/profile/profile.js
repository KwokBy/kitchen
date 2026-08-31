const { loadState, updateState } = require('../../services/store');
const kitchenService = require('../../services/kitchen');

Page({
  data: { state: {}, members: [], isKitchenOwner: false, activeTab: 'kitchen', showCreate: false, joinCode: '', showWechatProfile: false, draftAvatarUrl: '', draftNickname: '' },
  onLoad(options) { if (options.invite) this.setData({ joinCode: options.invite.toUpperCase(), activeTab: 'kitchen' }); },
  onShow() {
    if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({ selected: 3 });
    this.refresh();
    this.syncKitchen();
  },
  refresh() {
    const state = loadState();
    const kitchen = state.kitchen;
    let source = kitchen && kitchen.members ? kitchen.members : [];
    if (kitchen && !source.length) {
      const self = { userId: state.identity.openid, role: kitchen.role, nickname: state.identity.nickname || state.profile.meName, avatarUrl: state.identity.avatarUrl };
      source = kitchen.role === 'owner' ? [self] : [{ userId: 'owner', role: 'owner', nickname: '厨房主人', avatarUrl: '' }, self];
      if (kitchen.role === 'owner' && kitchen.memberCount >= 2) source.push({ userId: 'member', role: 'member', nickname: state.profile.partnerName, avatarUrl: '' });
    }
    const members = source.map(member => {
      const isMe = member.userId === state.identity.openid;
      const nickname = member.nickname || (isMe ? state.identity.nickname || state.profile.meName : member.role === 'owner' ? '厨房主人' : '受邀成员');
      return {
        ...member,
        isMe,
        nickname,
        avatarUrl: member.avatarUrl || (isMe && state.identity.profileComplete ? state.identity.avatarUrl : ''),
        initial: nickname.charAt(0) || (member.role === 'owner' ? '主' : '伴'),
        roleText: member.role === 'owner' ? (kitchen.ownerRoleName || '做饭主力') : (kitchen.memberRoleName || '点菜主力')
      };
    });
    this.setData({ state, members, isKitchenOwner: !!kitchen && kitchen.role === 'owner' });
  },
  async syncKitchen() {
    if (!this.data.state.identity || !this.data.state.identity.bound) return;
    try {
      await kitchenService.syncMyProfile();
      await kitchenService.refreshKitchen();
      this.refresh();
    } catch (error) {
      console.warn('厨房成员同步失败', error);
    }
  },
  setTabHidden(hidden) { if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({ hidden }); },
  switchProfileTab(event) { this.setData({ activeTab: event.currentTarget.dataset.tab, showCreate: false }); },
  handleMeProfile() { if (this.data.state.identity.bound) this.openWechatProfile(); else this.loginWechat(); },
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
    this.setTabHidden(true);
    this.setData({
      showWechatProfile: true,
      draftAvatarUrl: identity.avatarUrl || '',
      draftNickname: identity.profileComplete ? identity.nickname : ''
    });
  },
  closeWechatProfile() { this.setTabHidden(false); this.setData({ showWechatProfile: false }); },
  onUnload() { this.setTabHidden(false); },
  noop() {},
  onChooseAvatar(event) {
    const tempFilePath = event.detail.avatarUrl;
    wx.compressImage({
      src: tempFilePath,
      quality: 76,
      compressedWidth: 512,
      success: compressed => wx.saveFile({
        tempFilePath: compressed.tempFilePath,
        success: result => this.setData({ draftAvatarUrl: result.savedFilePath }),
        fail: () => this.setData({ draftAvatarUrl: compressed.tempFilePath })
      }),
      fail: () => wx.saveFile({
        tempFilePath,
        success: result => this.setData({ draftAvatarUrl: result.savedFilePath }),
        fail: () => this.setData({ draftAvatarUrl: tempFilePath })
      })
    });
  },
  onNicknameInput(event) { this.setData({ draftNickname: event.detail.value }); },
  async saveWechatProfile() {
    const nickname = this.data.draftNickname.trim();
    if (!this.data.draftAvatarUrl) return wx.showToast({ title: '请选择微信头像', icon: 'none' });
    if (!nickname) return wx.showToast({ title: '请选择微信昵称', icon: 'none' });
    updateState(state => {
      state.identity.avatarUrl = this.data.draftAvatarUrl;
      state.identity.nickname = nickname;
      state.identity.profileComplete = true;
      state.profile.meName = nickname;
    });
    this.setTabHidden(false);
    this.setData({ showWechatProfile: false });
    this.refresh();
    try {
      await kitchenService.syncMyProfile();
      await kitchenService.refreshKitchen();
      this.refresh();
      wx.showToast({ title: '微信资料已同步', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: '资料已保存，稍后自动同步', icon: 'none' });
    }
  },
  toggleCreate() {
    if (!this.data.state.identity.bound) return wx.showToast({ title: '请先微信登录', icon: 'none' });
    this.setData({ showCreate: !this.data.showCreate });
  },
  async createKitchen(event) {
    const name = event.detail.value.name.trim();
    if (!name) return wx.showToast({ title: '先给厨房起名', icon: 'none' });
    try { await kitchenService.createKitchen(name); this.setData({ showCreate: false }); this.refresh(); wx.showToast({ title: '厨房建好了', icon: 'success' }); }
    catch (error) { wx.showToast({ title: error.message || '创建失败，请稍后重试', icon: 'none' }); }
  },
  onJoinCode(event) { this.setData({ joinCode: event.detail.value.toUpperCase() }); },
  async joinKitchen() {
    if (!this.data.state.identity.bound) return wx.showToast({ title: '请先微信登录', icon: 'none' });
    if (this.data.joinCode.length !== 6) return wx.showToast({ title: '请输入6位邀请码', icon: 'none' });
    try { await kitchenService.joinKitchen(this.data.joinCode); this.refresh(); wx.showToast({ title: '已加入厨房', icon: 'success' }); }
    catch (error) { wx.showToast({ title: error.message || '邀请码无效或已过期', icon: 'none' }); }
  },
  copyInvite() { wx.setClipboardData({ data: this.data.state.kitchen.inviteCode }); },
  async saveKitchenSettings(event) {
    const values = event.detail.value;
    const settings = {
      name: values.name.trim(),
      ownerRoleName: values.ownerRoleName.trim(),
      memberRoleName: values.memberRoleName.trim()
    };
    if (!settings.name) return wx.showToast({ title: '厨房名称不能为空', icon: 'none' });
    if (!settings.ownerRoleName || !settings.memberRoleName) return wx.showToast({ title: '身份称呼不能为空', icon: 'none' });
    try {
      await kitchenService.updateKitchenSettings(settings);
      this.refresh();
      wx.showToast({ title: '厨房设置已同步', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败，请稍后重试', icon: 'none' });
    }
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
    if (!kitchen || kitchen.memberCount >= 2) return { title: '来看看「熹贵妃的小厨房」', path: '/pages/today/today' };
    return { title: `${this.data.state.profile.meName}邀请你加入「${kitchen.name}」`, path: `/pages/profile/profile?invite=${kitchen.inviteCode}` };
  }
});
