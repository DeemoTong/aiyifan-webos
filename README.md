# aiyifan-webos

一个面向 LG webOS TV 的非官方爱壹帆电视界面。当前自制 UI 版本为 **0.1.22**，已在 LG G4 上安装测试。项目用于个人学习与设备测试；影片、账号、会员权限和播放地址由爱壹帆官方服务提供。

## 已实现功能

| 区域 | 功能 |
| --- | --- |
| 首页与分类 | 推荐、电影、电视剧、综艺、动漫、纪录片、短剧、体育；分类标签和影片列表从官网动态读取，支持分页。 |
| 查找与详情 | 搜索影片、查看简介、语言和剧集；详情页读取官网评论并翻页浏览。评论目前只读。 |
| 观看历史 | 首页显示近期会员云端与本机记录；左侧独立“观看历史”分类以五列海报网格分页展示；可选择剧集并从保存位置续播。 |
| 登录 | 应用内扫码登录，另有官方账号登录入口；登录票据保存在电视本机，用于查询会员状态和申请播放。应用不保存密码。 |
| 自制播放器 | 根据官方返回的片源播放 HLS；提供实际可用的画质选项、加载状态、暂停、进度显示、短按或长按方向键定位，以及播放失败时切换官网播放器。 |
| 弹幕 | 读取影片弹幕，支持开关与 18、22、26、30 像素字号；设置保存在本机。 |
| 遥控器 | 方向键移动焦点，确认键操作，返回键回到上一层；可进入评论区逐条阅读。 |

电视上的倍速目前只提供 **1×**：LG G4 实测设置更高倍速后画面仍按约 1× 前进。电脑浏览器环境提供倍速选项，但不能替代电视实测。自制播放进度目前只保存在本机，尚未写回官网云端历史；评论不支持发表或回复。不同片源可用的画质、广告和播放权限取决于官网返回的结果。另附 `shell-app/` 纯网页套壳备选版本，安装时会替换同一应用 ID 的自制 UI。

## 前置条件

1. 一台支持 Developer Mode 的 LG webOS 电视，以及同一局域网内的电脑。当前主要在 **LG G4** 上验证；其他机型需要自行实测。
2. 电视安装 LG **Developer Mode** 应用，使用 LG Developer 账号登录，开启 **Dev Mode Status**，按提示重启电视，然后在应用内开启 **Key Server**。首次配对需要电视上显示的一次性口令。Developer Mode 会话到期后需要在电视上续期或重新开启。步骤见 [LG 官方 Developer Mode 指南](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app)。
3. 电脑安装 Node.js 24 或更新版本（含 npm）。项目把 [webOS CLI](https://webostv.developer.lge.com/develop/tools/cli-dev-guide) 列为开发依赖，运行 `npm ci` 后无需另装全局 CLI。

## 克隆后运行测试

在 PowerShell 中进入仓库根目录：

```powershell
npm ci
npm test
```

电脑上可用以下命令预览网页界面：

```powershell
npx ares-server .\app --open
```

电脑预览适合检查界面与普通导航；扫码登录的 webOS 服务桥接、电视遥控器和媒体播放仍需在电视上测试。

## 打包与安装到电视

先在 Developer Mode 应用中确认 **Dev Mode Status** 和 **Key Server** 已开启，并记下电视的局域网 IP。首次连接时，在仓库根目录运行（把 `TV_IP` 换成电视 IP）：

```powershell
npx ares-setup-device --add tv -i "host=TV_IP" -i "port=9922" -i "username=prisoner"
npx ares-novacom --device tv --getkey
```

`ares-novacom` 提示时，在电脑终端输入电视 Developer Mode 页面显示的口令。电视设备名 `tv` 只需配置一次；以后重启电视或 Key Server 后若连接失效，重新执行取密钥命令即可。LG 官方也提供[设备配对步骤](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app)。

打包、安装并启动当前自制 UI：

```powershell
.\tools\install.ps1 -Device tv
```

脚本会先运行 `npm run package`，生成 `dist/com.personal.iyftv_0.1.22_all.ipk`，再调用 `ares-install` 和 `ares-launch`。如需分开执行：

```powershell
npm run package
npx ares-install --device tv .\dist\com.personal.iyftv_0.1.22_all.ipk
npx ares-launch --device tv com.personal.iyftv
```

`dist/` 中的 IPK 是本机生成的安装包，不纳入 Git。需要调试电视中的应用时可用：

```powershell
npx ares-inspect --device tv --app com.personal.iyftv
```

## 目录

- `app/`：自制电视 UI、播放器和浏览逻辑。
- `auth-service/`：电视端扫码登录服务桥接。
- `tools/`：安装脚本与自动测试。
- `shell-app/`：直接打开原站的备选套壳应用。
- `fallback/`：早期网页回退原型。

这是非官方项目，不隶属于爱壹帆或 LG。仓库不包含登录密码、电视配对密钥或本机会话数据。
