const { updateState } = require('./store');
const { request, saveToken } = require('./http');

function inviteCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function bindIdentity() {
  if (getApp().globalData.backendMode === 'rust') {
    const login = await new Promise((resolve, reject) => wx.login({ success: resolve, fail: reject }));
    const response = await request('/v1/auth/wechat', { method: 'POST', data: { code: login.code } });
    saveToken(response.token);
    return updateState(state => {
      state.identity = { bound: true, openid: response.user.id, nickname: state.profile.meName };
    });
  }
  return updateState(state => {
    state.identity = { bound: true, openid: 'demo-openid', nickname: state.profile.meName };
  });
}

async function createKitchen(name) {
  if (getApp().globalData.backendMode === 'rust') {
    const response = await request('/v1/kitchens', { method: 'POST', data: { name } });
    return updateState(state => { state.kitchen = response.kitchen; });
  }
  return updateState(state => {
    state.kitchen = { id: `local-${Date.now()}`, name, inviteCode: inviteCode(), role: 'owner', memberCount: 1 };
  });
}

async function joinKitchen(code) {
  if (getApp().globalData.backendMode === 'rust') {
    const response = await request('/v1/kitchens/join', { method: 'POST', data: { inviteCode: code } });
    return updateState(state => { state.kitchen = response.kitchen; });
  }
  return updateState(state => {
    state.kitchen = { id: `joined-${code}`, name: '我们加入的厨房', inviteCode: code, role: 'member', memberCount: 2 };
  });
}

module.exports = { bindIdentity, createKitchen, joinKitchen };
