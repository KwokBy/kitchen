# 熹贵妃的小厨房

两个人一起点菜、安排菜单、管理冰箱存货的微信小程序 MVP。

## 当前范围

- 今日：一次滑动查看一道已安排的菜。
- 菜单：左侧菜名列表 + 中央单道大图，可新增、编辑和安排日期。
- 冰箱：记录存货数量、到期时间，并优先提示快到期食材。
- 我的：设置两个人的身份、菜品大类、新建厨房、分享或输入 6 位邀请码。
- 后端：Rust API 负责微信登录、共享厨房和成员关系；数据存 PostgreSQL。

## 技术结构

```text
miniprogram/   原生微信小程序
backend/       Rust + Axum + SQLx API
docker-compose.yml
```

没有使用微信云开发或云托管。正式环境由你的服务器提供 API 和 PostgreSQL。

## 先看小程序 UI

1. 安装微信开发者工具。
2. 导入当前目录，填写你自己的小程序 AppID（目前 `project.config.json` 是游客 AppID）。
3. `miniprogram/config/env.js` 保持 `backendMode: 'local'`。
4. 编译即可。此模式的数据只保存在开发者工具本地缓存中，方便先确认交互和视觉。

## 启动 Rust 后端

先创建配置：

```bash
cp backend/.env.example backend/.env
```

在 `backend/.env` 中填写小程序 AppID、AppSecret 和随机的 JWT_SECRET。AppSecret 只放在服务器，不要写进小程序代码。

有 Docker 时：

```bash
docker compose up --build
```

没有 Docker 时，先准备 PostgreSQL 并修改 `DATABASE_URL`，然后：

```bash
cd backend
cargo run
```

检查服务：

```bash
curl http://127.0.0.1:8787/healthz
```

## 让小程序连接后端

修改 `miniprogram/config/env.js`：

```js
module.exports = {
  backendMode: 'rust',
  apiBaseUrl: 'https://你的接口域名'
};
```

本地联调可以暂时使用局域网 HTTP 地址，并在微信开发者工具中关闭“校验合法域名”。真机和正式版本需要：

- 为 API 配置 HTTPS；
- 在微信公众平台将域名加入 `request` 合法域名；
- 服务器环境变量中使用正式的小程序 AppID 和 AppSecret。

## API

- `GET /healthz`
- `POST /v1/auth/wechat`：用 `wx.login()` 的 code 换取应用 JWT。
- `POST /v1/kitchens`：创建厨房并生成邀请码。
- `POST /v1/kitchens/join`：通过邀请码加入厨房。

菜品、菜单、冰箱和菜篮子目前在小程序本地数据层中，下一阶段再迁移到共享数据库，页面结构不需要推倒重做。
