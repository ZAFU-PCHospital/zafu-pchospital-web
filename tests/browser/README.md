# 活动对象页浏览器回归

`repair-activity-workspace.test.ts` 连接真实 Next 服务与 Chromium CDP，覆盖页签点击后的
URL / 面板更新、隐藏看板停止请求、历史前进 / 返回、搜索与面板实例保留、逐页签滚动恢复。

## 运行

1. 启动当前版本的 Next 服务。
2. 浏览器开放 CDP 端口，并登录具备活动管理权限的账号。
3. 选择正在进行且有报名记录的活动；测试使用 1280×600 视口，需要内容形成页面滚动。
4. 在 PowerShell 中执行：

```powershell
$env:ACTIVITY_WORKSPACE_BROWSER_URL='http://localhost:3000/admin/repair-activities/<活动ID>'
$env:CDP_PORT='9222'
corepack pnpm exec tsx --test tests/browser/repair-activity-workspace.test.ts
```

测试创建独立标签页，完成后关闭该标签页；仅发出读取请求，搜索与页签操作保留在客户端。
自动化夹具可通过 `ACTIVITY_WORKSPACE_BROWSER_COOKIE` 传入一个 Session Cookie；
不设置时复用浏览器已有登录态。夹具写入沿用独立 `_test` GreatSQL 的规则。

默认 `pnpm test` 在未设置 `ACTIVITY_WORKSPACE_BROWSER_URL` 时跳过此项。
升级 Next 时运行此回归，检查原生 history 与 `useSearchParams` 的联动。
