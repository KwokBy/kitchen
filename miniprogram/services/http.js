const TOKEN_KEY = 'xiguifei-auth-token';

function request(path, options = {}) {
  const app = getApp();
  const token = wx.getStorageSync(TOKEN_KEY);
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${app.globalData.apiBaseUrl}${path}`,
      method: options.method || 'GET',
      data: options.data,
      header: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
          return;
        }
        reject(new Error(response.data && response.data.message ? response.data.message : `请求失败（${response.statusCode}）`));
      },
      fail: reject
    });
  });
}

function saveToken(token) {
  wx.setStorageSync(TOKEN_KEY, token);
}

module.exports = { request, saveToken };
