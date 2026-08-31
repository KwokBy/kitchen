const { createDefaults } = require('../data/defaults');

const STORAGE_KEY = 'xiguifei-kitchen-v1';

function loadState() {
  const saved = wx.getStorageSync(STORAGE_KEY);
  if (!saved || !saved.dishes) {
    const initial = createDefaults();
    wx.setStorageSync(STORAGE_KEY, initial);
    return initial;
  }
  if ((saved.version || 1) < 2 || !saved.identity || typeof saved.identity.avatarUrl !== 'string' || typeof saved.identity.profileComplete !== 'boolean') {
    saved.version = 2;
    saved.identity = { bound: false, openid: '', nickname: '', avatarUrl: '', profileComplete: false, ...(saved.identity || {}) };
    wx.setStorageSync(STORAGE_KEY, saved);
  }
  return saved;
}

function saveState(state) {
  wx.setStorageSync(STORAGE_KEY, state);
  return state;
}

function updateState(mutator) {
  const state = loadState();
  mutator(state);
  return saveState(state);
}

module.exports = { loadState, saveState, updateState };
