# Windows 数据库开发环境（WSL + Docker）

应用、Node.js 与 pnpm 在 Windows 运行；Docker Engine 安装在 WSL 2 的 Debian 中，
GreatSQL 使用仓库的 `compose.greatsql.wsl.yml`。Windows 通过 `127.0.0.1:3307` 连接容器。
数据库版本、Migration 和生产权限规则仍以 [数据库指南](database.md) 为准。

服务器继续使用原 `compose.greatsql.yml`；本地文件独立维护，不叠加到部署配置上。
WSL 脚本显式使用 `-p zafu-pchospital-wsl`，使容器、网络和数据卷归属独立项目，
也避免工作目录或 `COMPOSE_PROJECT_NAME` 改变时意外接管其他环境。
例如本地卷名为 `zafu-pchospital-wsl_greatsql-data`；项目隔离规则见
[Docker Compose 项目名称说明](https://docs.docker.com/compose/how-tos/project-name/)。

本方案兼容 WSL 3.x，已在 WSL `3.0.3.0` + Debian（WSL 2 架构）上验证。
`wsl --version` 显示的是 WSL 软件包版本，`wsl --list --verbose` 的 `VERSION 2`
显示的是发行版架构，两者并不冲突。WSL 3.x 继续使用发行版内的 Docker Engine 与 Compose，
无需改用 WSL 自带的容器管理命令。软件版本说明见 [Microsoft WSL 发布记录](https://github.com/microsoft/WSL/releases)。

## 1. 安装 WSL 2

在管理员 PowerShell 中执行，按提示重启 Windows：

```powershell
wsl --install -d Debian
wsl --update
wsl --version
wsl --list --verbose
```

首次打开 Debian 时完成 Linux 用户创建。列表中 Debian 的 `VERSION` 应为 `2`；
已有 WSL 1 时执行 `wsl --set-version Debian 2`。安装遇到虚拟化或系统版本问题时，
参照 [Microsoft WSL 安装说明](https://learn.microsoft.com/en-us/windows/wsl/install)。

WSL 和 Debian 使用 Microsoft Store 官方分发，更新默认经 Store 获取；大陆环境优先保留
这条路径，勿改用依赖 GitHub 下载的 `--web-download`。这些 Windows 安装包没有在本文中
指定第三方镜像；下方 Linux 软件包、数据库镜像与 Node/pnpm 下载均提供国内镜像源。

本文默认发行版名为 `Debian`。已有其他发行版可以沿用，脚本通过 `-Distribution` 指定名称；
Docker 安装命令需使用该发行版的官方指南。

## 2. 在 Debian 中安装 Docker

在 PowerShell 运行 `wsl -d Debian` 进入 Debian，以下命令在 **Linux 终端**执行。
先备份并编辑现有 `/etc/apt/sources.list` 或 `/etc/apt/sources.list.d/debian.sources`，
把 `deb.debian.org/debian` 替换为 `mirrors.ustc.edu.cn/debian`，
把 `security.debian.org/debian-security` 替换为 `mirrors.ustc.edu.cn/debian-security`。
保留发行版代号、组件及 `Signed-By`，避免混用 Debian 版本；新式 `.sources` 与旧式 `.list`
均按这个规则替换。说明见 [中科大 Debian 镜像帮助](https://mirrors.ustc.edu.cn/help/debian.html)。

新装 Debian 按 [Docker 官方 Debian 安装指南](https://docs.docker.com/engine/install/debian/)
的步骤安装 Engine 与 Compose 插件，下列下载地址已替换为
[清华 Docker CE 镜像](https://mirrors.tuna.tsinghua.edu.cn/help/docker-ce/)：

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://mirrors.tuna.tsinghua.edu.cn/docker-ce/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://mirrors.tuna.tsinghua.edu.cn/docker-ce/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo service docker start
sudo docker info
sudo docker compose version
exit
```

已有 Docker 时先检查 `sudo docker info` 和 `sudo docker compose version`，无需重复安装。
若原先装过 `docker.io`、旧版 `docker-compose` 等冲突包，先按官方指南处理，勿混装。
脚本通过 WSL 的 root 用户管理 Docker，无需给 Linux 普通用户加入 `docker` 组。
此方案无需 Docker Desktop；已有 Desktop 时避免对同一发行版同时启用两套 Docker 引擎。

Compose 默认使用 GreatSQL 官方阿里云仓库
`registry.cn-beijing.aliyuncs.com/greatsql/greatsql:8.0.32-27`，直接拉取，不依赖公共 Docker Hub 加速器。
该版本也可从官方腾讯云仓库 `ccr.ccs.tencentyun.com/greatsql/greatsql:8.0.32-27` 拉取，
供应方说明见 [GreatSQL 官方镜像公告](https://greatsql.cn/thread-1005-1-1.html)。
需要切换时修改本地 Compose 的镜像仓库地址，版本必须保留 `8.0.32-27`；不要用 `latest`。

## 3. 配置项目与启动

回到 **Windows PowerShell**，在项目根目录执行（支持 Windows PowerShell 5.1 / PowerShell 7）：

Node.js 可从 [npmmirror 的 Node 二进制镜像](https://registry.npmmirror.com/binary.html?path=node/)
下载符合 `package.json` engines 的 Windows 安装包。先设置当前进程的下载源，再启用 Corepack
并安装项目依赖；这些变量不会修改全局或项目的包管理器配置：

```powershell
$env:COREPACK_NPM_REGISTRY = 'https://registry.npmmirror.com'
$env:npm_config_registry = 'https://registry.npmmirror.com'
$env:PRISMA_ENGINES_MIRROR = 'https://registry.npmmirror.com/-/binary/prisma'
corepack enable
.\tools\setup-greatsql-wsl.ps1
pnpm install
pnpm db:migrate:deploy
pnpm db:seed
pnpm db:health
pnpm dev
```

Corepack 仍使用 `package.json` 中固定的 pnpm 版本与完整性校验，锁文件保持不变。
如 Node 安装包未附带 Corepack，按 [Corepack 官方安装说明](https://github.com/nodejs/corepack)
准备它后再执行；`COREPACK_NPM_REGISTRY` 不要带末尾 `/`。

若本机执行策略阻止脚本，可仅在当前 PowerShell 进程启用
`Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned`，再执行。
其他发行版使用 `.\tools\setup-greatsql-wsl.ps1 -Distribution Ubuntu`。

配置脚本会：

- 检查 WSL 中的 Docker / Compose，必要时启动 Docker 服务；启动隐藏的 WSL 保活进程。
- 复用 Compose 启动固定版本 GreatSQL，等待容器健康并检查 Windows 的端口可达性。
- 创建 Migration 使用的 `zafu_pchospital_shadow` 并授权 `app_user`；创建
  `zafu_pchospital_test` 与 `test_user`，测试账号仅获得测试库权限，不授予全局权限。
- 仅在缺失时创建 `.env`，并为 `AUTH_SECRET`、`INVITE_CODE_PEPPER`、`PII_AUDIT_PEPPER`
  分别生成 32 个随机字节；仅在缺失时创建单行连接串文件 `.env.test.local`。

脚本只配置本地数据库与账号，不建业务表、不自动执行 Migration、Seed 或测试。
重复执行保留已有数据库、用户密码和环境文件。已有 `.env` 需自行检查连接串及三个密钥，
配置脚本不会替换占位值，也不会覆盖当前环境。若 PowerShell 中另有 `DATABASE_URL`，
它会优先于 `.env`；开始迁移前确认指向目标库。

默认值与 Compose 一致，**只用于本机开发**：

| 用途             | 数据库                   | 账号 / 密码                                   |
| ---------------- | ------------------------ | --------------------------------------------- |
| 开发             | `zafu_pchospital`        | `app_user` / `change-me`                      |
| Migration shadow | `zafu_pchospital_shadow` | `app_user` / `change-me`                      |
| 集成测试         | `zafu_pchospital_test`   | `test_user` / `local-test-change-me`          |
| 容器管理         | —                        | `root` / `local-root-change-me`（容器内使用） |

生成的连接串包含 `?allowPublicKeyRetrieval=true`，用于本机非 TLS 的 MySQL 8 认证；
生产须使用 TLS，不能沿用该配置，原理见 [数据库指南第 7 节](database.md#7-检查与测试)。
`.env`、`.env.test.local` 已被 Git 忽略，不要提交。修改 Compose 密码不会改变已有数据卷中的密码；
已有实例需要先按原凭据登录并显式修改密码，再同步连接串。

Seed 只初始化角色、分类与技能，不创建默认登录账号；首个管理员由维护者初始化。
开发业务表结构时使用 Prisma Migration，禁止 `db push` 或手工建业务表。
`db:migrate:dev` 使用脚本准备的独立 shadow database，现有 `prisma.config.ts` 会从开发库
连接串推导其名称；自定义环境可通过 `SHADOW_DATABASE_URL` 显式指定。
shadow database 会被 Prisma 重置，绝不能指向开发库或测试库；原理见
[Prisma shadow database 说明](https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/shadow-database)。
本地账号具备迁移所需的 DDL 权限，生产仍须按数据库指南分离应用与 Migration 账号。

## 4. 独立测试库

配置脚本已建测试库；`.env.test.local` 不会被 `pnpm test:db` 自动读取。
在项目根目录显式切换进程环境变量，并在结束后恢复原值：

```powershell
$previousDatabaseUrl = $env:DATABASE_URL
try {
  $testEnv = (Get-Content .env.test.local -Raw).Trim()
  if ($testEnv -notmatch '^DATABASE_URL=(\S+)$') { throw '测试环境文件应只有一行 DATABASE_URL' }
  $testUrl = $Matches[1]
  if (([uri]$testUrl).AbsolutePath -notmatch '_test$') { throw '拒绝使用非测试库' }
  $env:DATABASE_URL = $testUrl
  pnpm db:migrate:deploy
  if ($LASTEXITCODE -ne 0) { throw '测试库 Migration 失败' }
  pnpm db:seed
  if ($LASTEXITCODE -ne 0) { throw '测试库 Seed 失败' }
  pnpm db:health
  if ($LASTEXITCODE -ne 0) { throw '测试库健康检查失败' }
  pnpm test:db
  if ($LASTEXITCODE -ne 0) { throw '集成测试失败' }
} finally {
  if ($null -eq $previousDatabaseUrl) {
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  } else {
    $env:DATABASE_URL = $previousDatabaseUrl
  }
}
```

测试会创建、删除夹具，部分用例会整表清空。不要指向开发库，不要打开
`ALLOW_NON_TEST_DB` / `ALLOW_DESTRUCTIVE_DB_TESTS` 绕过闸门；同一测试库不要同时运行两轮测试。
详见 [工程手册第 6.1 节](../AGENTS.md#61-pnpm-testdb-必须指向独立测试库已加闸门)。

## 5. 日常启动、停止与排错

重启 Windows 或关闭 WSL 后，执行 `.\tools\start-greatsql-wsl.ps1` 即可；
它不修改环境文件，也不配置测试库。Compose 的 `restart: unless-stopped` 只有在 Docker
运行时才生效，不能自行唤醒 WSL。

脚本输出保活进程 PID。正常开发时保留该进程；仅 systemd 服务不会维持 WSL 存活，
参见 [Microsoft 的 systemd 说明](https://devblogs.microsoft.com/commandline/systemd-support-is-now-available-in-wsl/)。
需要结束开发时，先停容器，再按脚本输出的 PID 结束保活进程：

```powershell
wsl -d Debian -u root --cd "$PWD" --exec docker compose -p zafu-pchospital-wsl -f compose.greatsql.wsl.yml ps
wsl -d Debian -u root --cd "$PWD" --exec docker compose -p zafu-pchospital-wsl -f compose.greatsql.wsl.yml logs --tail 100 greatsql
wsl -d Debian -u root --cd "$PWD" --exec docker compose -p zafu-pchospital-wsl -f compose.greatsql.wsl.yml stop
# Stop-Process -Id <脚本输出的保活 PID>
```

以上命令在项目根目录运行；发行版名称需与配置时一致。`wsl --terminate Debian` 也会终止
该发行版的所有进程，只有确认没有其他任务时再使用。停止容器或 `down` 会保留数据卷；
**不要执行 `down -v` 或删除 volume**，那会丢弃数据库。

| 现象                                       | 处理                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 找不到发行版 / WSL 命令失败                | 用 `wsl --list --verbose` 确认名称与版本；必要时更新 WSL、重启 Windows                                          |
| `docker: command not found` / 缺少 Compose | 在对应发行版按第 2 节安装 Engine 与 Compose 插件                                                                |
| Docker 服务启动失败                        | 在 Debian 检查 `sudo service docker status` 与服务日志；支持 systemd 的环境也可用 `sudo systemctl start docker` |
| 拉取镜像失败                               | 检查 WSL 到官方阿里云仓库的网络访问；必要时换官方腾讯云仓库，保留固定版本                                       |
| 容器健康但 Windows 无法连接                | 检查 Windows 3307 是否被占用、WSL localhost 转发及防火墙；用 `Test-NetConnection 127.0.0.1 -Port 3307` 检查     |
| `mysqld got signal 8`                      | 保留 Compose 的 `cap_add: [SYS_NICE]`，避免原生 WSL 的 NUMA 初始化问题                                          |
| RSA 公钥 / 连接池超时错误                  | 本地非 TLS 连接按第 3 节追加 `allowPublicKeyRetrieval=true`；确认实际读取的是哪个环境变量                       |
| 旧数据挂载提示                             | 先按第 6 节备份，不能直接重建容器                                                                               |

WSL 的 NAT 网络默认启用 Windows 到 Linux 的 localhost 转发；如 `%UserProfile%\.wslconfig` 中主动关闭了
`localhostForwarding`，需要恢复该配置后重启 WSL。具体行为见
[Microsoft WSL 配置说明](https://learn.microsoft.com/en-us/windows/wsl/wsl-config#configuration-settings-for-wslconfig)。
无需把数据库端口暴露到局域网或额外配置 `netsh portproxy`。
WSL 3.x 的默认网络可能与旧版本不同，以脚本的 Windows TCP 检查结果为准；出现连接问题时
检查正在使用的网络模式，不要通过把 Compose 端口改成 `0.0.0.0` 来绕过。

## 6. 旧环境的数据挂载处理

旧 Compose 把卷挂在 `/var/lib/mysql`，但固定镜像的数据目录实际为 `/data/GreatSQL`。
这种环境的数据可能只在容器可写层内；直接 `up` 重建、`down` 删除容器都会让它不可恢复。
新脚本使用独立的 `zafu-pchospital-wsl` 项目，不会接管旧项目的容器或复用旧项目的数据卷。
若旧的本地容器占用 3307，新项目会因端口冲突启动失败；不要为了让新项目启动而直接删除旧容器。
先完成备份与迁移计划，再手动停止旧容器并初始化新项目。脚本也会检查本地新项目的挂载，
发现其仍是旧挂载时拒绝自动重建。

保留旧容器，先用原凭据做逻辑备份（在 WSL 中把 `mysqldump` 输出重定向到 Linux 文件，
避免旧版 Windows PowerShell 将 SQL 写成 UTF-16），检查备份内容并验证能恢复。
然后在独立的 Compose 项目与新卷上初始化正确挂载、恢复备份，确认业务数据和账号可用后再切换。
账号授权需单独核对，不能只恢复业务表就宣布迁移成功。旧容器与备份应保留到迁移验收完成。

如果旧容器已被删除，而旧卷里没有真实数据文件，挂载修正不会找回数据，只能从先前备份恢复。
配置脚本不自动搬迁、删除卷或清空数据。
