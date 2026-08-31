const { loadState } = require('./store');
const { request } = require('./http');

const SUBSCRIBE_TEMPLATE_ID = 'TRB0XLJlO3Dw0DQHs0B_jMEXYU9crlV6Wb8jpBpNA0A';

function available() {
  const state = loadState();
  return getApp().globalData.backendMode === 'rust' && state.identity.bound && state.kitchen;
}

async function list() {
  if (!available()) return { notifications: [], unreadCount: 0 };
  return request('/v1/notifications');
}

async function sendMenuReady(date, dishNames) {
  if (!available()) return null;
  return request('/v1/notifications', { method: 'POST', data: { kind: 'menu_ready', date, dishNames } });
}

async function remindPicker() {
  if (!available()) return null;
  return request('/v1/notifications', { method: 'POST', data: { kind: 'pick_reminder' } });
}

async function markAllRead() {
  if (!available()) return;
  await request('/v1/notifications/read', { method: 'PUT' });
}

function subscribeWechat() {
  return new Promise((resolve, reject) => wx.requestSubscribeMessage({
    tmplIds: [SUBSCRIBE_TEMPLATE_ID],
    success: result => resolve(result[SUBSCRIBE_TEMPLATE_ID] === 'accept'),
    fail: reject
  }));
}

module.exports = { list, sendMenuReady, remindPicker, markAllRead, subscribeWechat };
