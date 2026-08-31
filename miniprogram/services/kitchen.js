const { loadState, updateState } = require('./store');
const { request, saveToken } = require('./http');

function absoluteAvatarUrl(value) {
  if (!value || /^https?:\/\//.test(value) || !value.startsWith('/')) return value || '';
  return `${getApp().globalData.apiBaseUrl}${value}`;
}

function normalizeKitchen(kitchen) {
  if (!kitchen) return null;
  return {
    ...kitchen,
    members: (kitchen.members || []).map(member => ({ ...member, avatarUrl: absoluteAvatarUrl(member.avatarUrl) }))
  };
}

function readFileBase64(filePath) {
  return new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath, encoding: 'base64', success: result => resolve(result.data), fail: reject }));
}

function downloadFile(url) {
  return new Promise((resolve, reject) => wx.downloadFile({
    url,
    success: result => result.statusCode === 200 ? resolve(result.tempFilePath) : reject(new Error(`头像下载失败（${result.statusCode}）`)),
    fail: reject
  }));
}

function compressAvatar(filePath) {
  return new Promise(resolve => wx.compressImage({
    src: filePath,
    quality: 76,
    compressedWidth: 512,
    success: result => resolve(result.tempFilePath),
    fail: () => resolve(filePath)
  }));
}

async function readAvatarBase64(avatarUrl) {
  const filePath = /^https?:\/\//.test(avatarUrl) ? await downloadFile(avatarUrl) : avatarUrl;
  return readFileBase64(await compressAvatar(filePath));
}

function imageContentType(base64) {
  if (base64.startsWith('iVBOR')) return 'image/png';
  if (base64.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}

async function syncMyProfile() {
  if (getApp().globalData.backendMode !== 'rust') return;
  const state = loadState();
  const identity = state.identity;
  if (!identity.bound || !identity.profileComplete) return;
  const signature = `v2:${identity.nickname}\n${identity.avatarUrl}`;
  if (identity.remoteProfileSignature === signature) return;
  let avatarData;
  let avatarReady = !identity.avatarUrl;
  const ownAvatarPrefix = `${getApp().globalData.apiBaseUrl}/v1/users/`;
  if (identity.avatarUrl.startsWith(ownAvatarPrefix)) avatarReady = true;
  else if (identity.avatarUrl) {
    try {
      avatarData = await readAvatarBase64(identity.avatarUrl);
      avatarReady = true;
    } catch (_) {}
  }
  await request('/v1/users/me/profile', {
    method: 'PUT',
    data: {
      nickname: identity.nickname,
      ...(avatarData ? { avatarData, avatarContentType: imageContentType(avatarData) } : {})
    }
  });
  updateState(next => { next.identity.remoteProfileSignature = avatarReady ? signature : `v2:${identity.nickname}\n`; });
}

async function refreshKitchen() {
  if (getApp().globalData.backendMode !== 'rust') return loadState().kitchen;
  const response = await request('/v1/kitchens');
  const kitchen = normalizeKitchen(response.kitchen);
  updateState(state => { state.kitchen = kitchen; });
  return kitchen;
}

function inviteCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function bindIdentity() {
  if (getApp().globalData.backendMode === 'rust') {
    const login = await new Promise((resolve, reject) => wx.login({ success: resolve, fail: reject }));
    const response = await request('/v1/auth/wechat', { method: 'POST', data: { code: login.code } });
    saveToken(response.token);
    updateState(state => {
      state.identity = { ...state.identity, bound: true, openid: response.user.id };
    });
    await syncMyProfile();
    await refreshKitchen();
    return loadState();
  }
  return updateState(state => {
    state.identity = { ...state.identity, bound: true, openid: 'demo-openid' };
  });
}

async function createKitchen(name) {
  const currentState = loadState();
  if (currentState.kitchen) throw new Error('每个人只能拥有一个厨房');
  if (getApp().globalData.backendMode === 'rust') {
    await syncMyProfile();
    const response = await request('/v1/kitchens', { method: 'POST', data: { name } });
    return updateState(state => { state.kitchen = normalizeKitchen(response.kitchen); });
  }
  return updateState(state => {
    state.kitchen = { id: `local-${Date.now()}`, name, inviteCode: inviteCode(), role: 'owner', memberCount: 1, members: [{ userId: state.identity.openid, role: 'owner', nickname: state.identity.nickname, avatarUrl: state.identity.avatarUrl }] };
  });
}

async function joinKitchen(code) {
  const currentState = loadState();
  if (currentState.kitchen) throw new Error('你已经有厨房了，不能再加入其他厨房');
  if (getApp().globalData.backendMode === 'rust') {
    await syncMyProfile();
    const response = await request('/v1/kitchens/join', { method: 'POST', data: { inviteCode: code } });
    return updateState(state => { state.kitchen = normalizeKitchen(response.kitchen); });
  }
  return updateState(state => {
    state.kitchen = { id: `joined-${code}`, name: '我们加入的厨房', inviteCode: code, role: 'member', memberCount: 2, members: [{ userId: 'local-owner', role: 'owner', nickname: '厨房主人', avatarUrl: '' }, { userId: state.identity.openid, role: 'member', nickname: state.identity.nickname, avatarUrl: state.identity.avatarUrl }] };
  });
}

module.exports = { bindIdentity, createKitchen, joinKitchen, syncMyProfile, refreshKitchen, normalizeKitchen };
