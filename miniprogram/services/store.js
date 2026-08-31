const { createDefaults } = require('../data/defaults');

const STORAGE_KEY = 'xiguifei-kitchen-v1';

function loadState() {
  const saved = wx.getStorageSync(STORAGE_KEY);
  if (!saved || !saved.dishes) {
    const initial = createDefaults();
    wx.setStorageSync(STORAGE_KEY, initial);
    return initial;
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
