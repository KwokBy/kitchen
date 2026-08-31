const env = require('./config/env');

App({
  onLaunch() {
    this.globalData.backendMode = env.backendMode;
    this.globalData.apiBaseUrl = env.apiBaseUrl;
  },
  globalData: {
    backendMode: 'local',
    apiBaseUrl: '',
    openWishPicker: false
  }
});
