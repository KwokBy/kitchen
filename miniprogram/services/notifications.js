const { loadState } = require('./store');
const { request } = require('./http');

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

module.exports = { list, sendMenuReady, remindPicker, markAllRead };
