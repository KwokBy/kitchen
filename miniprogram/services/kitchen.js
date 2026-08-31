const { loadState, updateState } = require('./store');
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
    const kitchenResponse = await request('/v1/kitchens');
    return updateState(state => {
      state.identity = { ...state.identity, bound: true, openid: response.user.id };
      state.kitchen = kitchenResponse.kitchen || null;
    });
  }
  return updateState(state => {
    state.identity = { ...state.identity, bound: true, openid: 'demo-openid' };
  });
}

async function createKitchen(name) {
  const currentState = loadState();
  if (currentState.kitchen) throw new Error('每个人只能拥有一个厨房');
  if (getApp().globalData.backendMode === 'rust') {
    const response = await request('/v1/kitchens', { method: 'POST', data: { name } });
    return updateState(state => { state.kitchen = response.kitchen; });
  }
  return updateState(state => {
    state.kitchen = { id: `local-${Date.now()}`, name, inviteCode: inviteCode(), role: 'owner', memberCount: 1 };
  });
}

async function joinKitchen(code) {
  const currentState = loadState();
  if (currentState.kitchen) throw new Error('你已经有厨房了，不能再加入其他厨房');
  if (getApp().globalData.backendMode === 'rust') {
    const response = await request('/v1/kitchens/join', { method: 'POST', data: { inviteCode: code } });
    return updateState(state => { state.kitchen = response.kitchen; });
  }
  return updateState(state => {
    state.kitchen = { id: `joined-${code}`, name: '我们加入的厨房', inviteCode: code, role: 'member', memberCount: 2 };
  });
}

module.exports = { bindIdentity, createKitchen, joinKitchen };
