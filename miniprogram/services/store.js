const { createDefaults } = require('../data/defaults');

const STORAGE_KEY = 'xiguifei-kitchen-v1';

function loadState() {
  const saved = wx.getStorageSync(STORAGE_KEY);
  if (!saved || !saved.dishes) {
    const initial = createDefaults();
    wx.setStorageSync(STORAGE_KEY, initial);
    return initial;
  }
  let changed = false;
  if ((saved.version || 1) < 2 || !saved.identity || typeof saved.identity.avatarUrl !== 'string' || typeof saved.identity.profileComplete !== 'boolean') {
    saved.identity = { bound: false, openid: '', nickname: '', avatarUrl: '', profileComplete: false, ...(saved.identity || {}) };
    changed = true;
  }
  if ((saved.version || 1) < 3 || saved.dishes.some(dish => !Array.isArray(dish.planDates))) {
    saved.dishes.forEach(dish => {
      dish.planDates = [...new Set((Array.isArray(dish.planDates) ? dish.planDates : (dish.planDate ? [dish.planDate] : [])).filter(Boolean))].sort();
      delete dish.planDate;
    });
    changed = true;
  }
  saved.version = 3;
  if (changed) wx.setStorageSync(STORAGE_KEY, saved);
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
