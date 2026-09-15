# 电脑医院官网第二期模块化开发文档

> Phase 2
> 开发定位：内部成员系统 + 维修数据平台
> 用途：多人协作开发、Agent 开发任务拆分、PR 验收与模块集成

---

# 0. 当前开发状态

> 更新时间：2026-09-16。状态以组织仓库 PR 合并结果为准。

| 模块                    | 状态      | 当前说明                                                        |
| ----------------------- | --------- | --------------------------------------------------------------- |
| M0 基础架构与数据契约   | PR 准备中 | `feat/p2-m0-foundation` 已完成实现和本地验收，待提交组织仓库 PR |
| M1 账号与权限           | 未开始    | 依赖 M0 合并                                                    |
| M2 维修记录核心         | 未开始    | 依赖 M0 合并；与 M1 可在契约稳定后并行                          |
| M3 成员工作台与个人主页 | 未开始    | 依赖 M1 / M2                                                    |
| M4 内部交流与通知       | 未开始    | 依赖 M2                                                         |
| M5 数据统计与排行榜     | 未开始    | 依赖 M2                                                         |
| M6 管理后台             | 未开始    | 依赖 M1 / M2 及相关领域能力                                     |
| M7 官网公开数据接入     | 未开始    | 依赖 M5                                                         |

M0 已落地 GreatSQL / Prisma、版本化 Migration、统一 User / Role / MemberProfile、
JoinApplication、InviteCode、AccountProvision、公共 Enum / API Contract、权限与审计骨架。
真实 GreatSQL 并发测试验证邀请码同码限次复用，`usedCount` 仅在事务内自动累计。

M0 后续治理 Issue（由维护者手动加入需要的 Project / Milestone）：

- [#22 多实例共享限流](https://github.com/ZAFU-PCHospital/zafu-pchospital-web/issues/22)
- [#23 招募批次配置与生命周期](https://github.com/ZAFU-PCHospital/zafu-pchospital-web/issues/23)
- [#24 数据保留、删除与匿名化](https://github.com/ZAFU-PCHospital/zafu-pchospital-web/issues/24)
- [#25 PII 权限、脱敏与导出审计](https://github.com/ZAFU-PCHospital/zafu-pchospital-web/issues/25)

---

# 1. 文档目标

第二期开发采用：

> **模块独立开发 + 公共契约统一管理 + 分阶段集成**

开发模式。

第二期最终需要形成以下完整链路：

```text
成员账号
  ↓
登录成员工作台
  ↓
提交维修记录
  ↓
管理员审核
  ↓
生成正式维修数据
  ↓
个人统计 / 排行榜
  ↓
内部讨论与案例沉淀
  ↓
官网公开数据展示
```

多人开发时，各模块可以独立开发，但以下内容必须统一管理：

```text
数据库 Schema
公共 Type
Enum
API Contract
权限定义
公共组件
全局配置
```

禁止各模块自行创造不兼容的数据结构。

---

# 2. 模块总览

第二期拆分为：

```text
M0  基础架构与数据契约

M1  账号与权限

M2  维修记录核心

M3  成员工作台与个人主页

M4  内部交流与通知

M5  数据统计与排行榜

M6  管理后台

M7  官网公开数据接入
```

整体依赖：

```text
                 M0
               /    \
             M1      M2
             │       │
             │   ┌───┼────┐
             │   │   │    │
             ▼   ▼   ▼    ▼
            M3  M4   M5   M6
                     │
                     ▼
                     M7
```

其中：

> M2「维修记录核心」是第二期最核心的业务模块。

其他多个模块都会依赖 RepairRecord。

---

# 3. 公共开发规则

## 3.1 禁止模块私自修改公共契约

以下文件或模块属于高冲突区域：

```text
数据库 Schema
Migration
公共 Enum
公共 Type
Authentication Middleware
Authorization Middleware
API Response Type
全局导航
公共 Layout
Theme
package.json
lockfile
```

修改前必须搜索全部消费者并记录影响范围。若影响其他模块，必须在同一变更中同步贯通
实现、Migration、Contract、调用方、测试与文档；不要求单独评审，但禁止只修当前模块。

---

# 4. 公共数据库原则

第二期建议至少存在以下领域实体：

```text
User
Role
MemberProfile

Skill
UserSkill

RepairRecord
RepairCategory
RepairPhoto

RepairComment
RepairFavorite

RepairAuditLog
RepairTimeline

Notification
```

预留：

```text
ExternalIdentity
QQIdentity
WeChatIdentity
```

但第二期暂不实现第三方 OAuth。

---

# 5. 公共 ID 规则

所有核心实体统一使用同一种 ID 策略。

例如：

```text
UUID
```

或者项目最终确定的其他统一方案。

禁止：

```text
User 用 UUID

RepairRecord 用 bigint

Comment 又使用另一种随机字符串
```

除非架构负责人明确决定。

---

# 6. 公共时间字段

核心实体建议统一包含：

```text
createdAt
updatedAt
```

需要软删除的实体：

```text
deletedAt
```

业务时间与系统时间分开。

例如维修记录：

```text
repairDate
```

表示实际维修日期。

```text
createdAt
```

表示记录创建时间。

不得混用。

---

# 7. 公共软删除规则

以下数据原则上采用软删除：

```text
User
RepairRecord
RepairComment
```

普通查询默认：

```text
deletedAt IS NULL
```

禁止管理员删除维修记录后直接永久丢失数据。

---

# 8. 公共维修审核状态

维修状态统一定义：

```text
DRAFT
PENDING
APPROVED
REJECTED
```

对应：

```text
草稿
待审核
已通过
已退回
```

模块不得私自增加：

```text
FINISHED
SUCCESS
CHECKED
PASSED
```

等含义重复状态。

---

# 9. 公共维修结果

第二期第一版：

```text
COMPLETED
UNCOMPLETED
```

对应：

```text
已完成
未完成
```

以后如果扩展：

```text
PARTIAL
REFERRED
```

必须统一升级 Enum。

---

# 10. 正式统计数据规则

以下功能：

```text
个人正式维修数量
维修排行榜
首页累计维修数
本月维修量
本学期维修量
维修趋势
累计维修时长
```

只能统计：

```text
status = APPROVED
```

的数据。

草稿、待审核、已退回记录一律不得计入正式统计。

---

# 11. 权限原则

权限必须在服务端验证。

不能使用：

```text
前端隐藏按钮
```

作为真正权限控制。

基本角色：

```text
VISITOR

MEMBER

ADMIN

PRESIDENT
```

权限关系原则：

```text
PRESIDENT
    ↓
 ADMIN
    ↓
 MEMBER
    ↓
VISITOR
```

具体高权限继承方式由后端实现决定。

---

# 12. M0：基础架构与数据契约

当前 M0 分支：

```text
feat/p2-m0-foundation
```

---

## 12.1 目标

建立其他二期模块可以共同依赖的基础设施。

M0 不负责大量业务页面。

重点是：

> 把多人开发需要共同遵守的东西先定下来。

---

## 12.2 工作内容

包括：

```text
数据库连接
ORM 配置
Migration 机制
基础 Schema
公共 Enum
公共 Type
API Response 规范
错误处理规范
权限中间件骨架
文件目录规范
环境变量规范
```

---

## 12.3 优先定义实体

M0 已定义：

```text
User
Role
MemberProfile
UserIdentity
PasswordCredential
JoinApplication
JoinApplicationReview
InviteCode
InviteCodeRedemption
AccountProvision
AuditLog
```

RepairRecord 等维修领域实体由 M2 基于 M0 公共 ID、账户与 Contract 规则新增，不在 M0
提前落表。

---

## 12.4 环境变量

统一：

```text
DATABASE_URL

AUTH_SECRET

APP_BASE_URL

RECRUITMENT_CYCLE

INVITE_CODE_PEPPER

PII_AUDIT_PEPPER

UPLOAD_PATH

UPLOAD_MAX_BYTES
```

等命名。

不得每个模块自己创建：

```text
DB_URL
MYSQL_URL
DATABASE_ADDRESS
```

等重复配置。

---

## 12.5 API 返回格式

统一项目 API 格式。

例如：

```json
{
  "success": true,
  "data": {}
}
```

错误：

```json
{
  "success": false,
  "error": {
    "code": "AUTH_INVALID_PASSWORD",
    "message": "账号或密码错误"
  }
}
```

实际结构根据现有项目确定。

一旦确定，不得各模块自行改变。

---

## 12.6 验收

M0 PR 当前已验证：

- 数据库可以正常连接
- Migration 可从空库执行，重复 deploy 无待执行项
- 统一 User / Role / MemberProfile 与招募、邀请码、发放、审计表可创建
- 公共 Enum / API Contract 可以复用
- 环境变量有示例文件
- 邀请码同码限次复用在并发下不超发，`usedCount` 无管理写入口
- lint、完整 build、单元测试、Contract 测试与真实 GreatSQL 集成测试通过
- 后续模块可以直接开始业务开发

---

# 13. M1：账号与权限

建议分支：

```text
feat/p2-auth
```

依赖：

```text
M0
```

---

# 14. M1 目标

实现：

> 第二期内部成员账号系统。

当前登录方式：

```text
QQ号 + 密码
```

但是内部架构不能把：

```text
QQ号
```

设计成用户本体。

---

# 15. M1 用户模型

核心关系：

```text
User
 │
 ├── MemberProfile
 ├── Role
 └── Login Identity
```

第二期可以使用：

```text
QQ Number
+
Password
```

完成认证。

以后可以增加：

```text
账号密码
QQ OAuth
微信 OAuth
```

而不需要重构 User。

---

# 16. M1 功能范围

负责：

- 登录
- 登出
- Session
- 当前用户查询
- 首次登录修改密码
- 修改密码
- 角色权限
- 登录保护
- 成员账号状态

---

# 17. M1 首次登录流程

```text
管理员创建账号
        ↓
生成初始密码
        ↓
成员登录
        ↓
检测 mustChangePassword
        ↓
强制进入修改密码页面
        ↓
修改成功
        ↓
进入工作台
```

---

# 18. M1 安全要求

数据库禁止存储：

```text
明文密码
```

使用安全密码哈希算法。

同时：

- 登录接口限制异常尝试
- Session 安全
- Cookie 合理配置
- 后端权限校验
- 禁用账号不能继续登录

---

# 19. M1 页面

负责：

```text
/login

/change-password
```

以及相关认证 UI。

---

# 20. M1 API 建议

例如：

```text
POST /api/auth/login

POST /api/auth/logout

GET /api/auth/me

POST /api/auth/change-password
```

具体路径服从现有项目 API 规则。

---

# 21. M1 验收

必须跑通：

```text
QQ号 + 初始密码
        ↓
登录
        ↓
强制修改密码
        ↓
进入工作台
```

以及：

- 密码错误不能登录
- 禁用账号不能登录
- MEMBER 无法访问 ADMIN API
- 刷新后登录状态保持正常

---

# 22. M2：维修记录核心

建议分支：

```text
feat/p2-repairs
```

依赖：

```text
M0

部分依赖 M1 用户身份
```

M2 是第二期核心模块。

---

# 23. M2 数据实体

主要负责：

```text
RepairRecord

RepairCategory

RepairPhoto

RepairAuditLog

RepairTimeline
```

---

# 24. RepairRecord 建议字段

至少：

```text
id

memberId

repairDate

durationMinutes

categoryId

content

result

remark

status

isDifficult

isTypical

createdAt

updatedAt

deletedAt
```

实际 Schema 由团队最终确认。

---

# 25. M2 功能

成员：

```text
创建维修记录

保存草稿

修改草稿

提交审核

修改被退回记录

重新提交

查看记录详情
```

管理员审核接口由 M2 提供底层能力，M6 提供管理 UI。

---

# 26. 状态流转

只允许：

```text
DRAFT
 ↓
PENDING
 ↓   ↓
APPROVED
REJECTED
```

REJECTED：

```text
成员修改
   ↓
重新提交
   ↓
PENDING
```

禁止非法状态跳转。

---

# 27. 已审核记录修改

普通成员原则上不能直接修改：

```text
APPROVED
```

记录。

如需修改：

- 管理员处理
- 或进入新的审核流程

不得直接破坏历史统计。

---

# 28. 故障分类

初始建议：

```text
散热 / 清灰

硬件故障

系统问题

软件问题

驱动问题

网络问题

磁盘 / 存储

外设问题

其他
```

分类数据由管理员维护。

---

# 29. 图片上传

至少支持：

```text
photos[]
```

要求：

- 至少 1 张
- 限制文件类型
- 限制文件大小
- 限制上传数量
- 服务端重新生成文件名
- 不直接信任客户端文件名

---

# 30. 维修时长

数据库统一存储：

```text
durationMinutes
```

例如：

```text
90
```

UI 显示：

```text
1 小时 30 分钟
```

---

# 31. M2 页面

负责：

```text
/member/repairs

/member/repairs/new

/member/repairs/[id]

维修记录编辑页面
```

---

# 32. M2 搜索能力

至少为后续模块提供：

```text
成员
故障分类
状态
维修结果
日期范围
疑难案例
典型案例
关键词
```

筛选能力。

---

# 33. M2 Timeline

重要行为写入时间线：

```text
创建

修改

提交审核

审核通过

审核退回
```

评论是否写入 Timeline 可由 M4 接入。

---

# 34. M2 验收

必须跑通：

```text
创建
↓
保存草稿
↓
修改
↓
上传照片
↓
提交审核
↓
管理员审核
↓
APPROVED
```

并确保：

```text
APPROVED
```

前后的权限限制正确。

---

# 35. M3：成员工作台与个人主页

建议分支：

```text
feat/p2-member-dashboard
```

依赖：

```text
M1
M2
```

---

# 36. M3 目标

负责成员登录后的主要工作空间。

---

# 37. M3 工作台

路径：

```text
/member
```

建议展示：

```text
维修总数

本学期维修数

本月维修数

累计维修时长

最近维修记录

待处理通知

收藏记录

排行榜简版

新增维修记录快捷入口
```

---

# 38. M3 个人主页

路径：

```text
/member/profile
```

展示：

```text
头像

姓名 / 昵称

成员身份

加入时间

技能标签

累计维修数

本学期维修数

本月维修数

累计维修时长

最近维修记录
```

QQ号：

```text
仅内部可见
```

---

# 39. 技能标签

实体：

```text
Skill

UserSkill
```

例如：

```text
Windows

硬件

网络

Linux

笔记本拆机

系统安装

驱动问题

磁盘
```

M3 负责展示和成员资料关联。

标签库管理由 M6 负责。

---

# 40. M3 边界

M3 不重新实现统计算法。

正式统计数据应调用：

```text
M5
```

提供的统一统计能力。

开发早期可以使用 Mock / 临时接口。

后续替换为 M5。

---

# 41. M3 验收

成员登录后可以正常查看：

```text
工作台

个人资料

技能标签

个人维修记录

个人统计
```

Normal / Dark 两种主题均正常。

---

# 42. M4：内部交流与通知

建议分支：

```text
feat/p2-community
```

依赖：

```text
M1
M2
```

---

# 43. M4 定位

每条维修记录都可以成为：

> 一个内部技术讨论主题。

不是独立大型论坛。

讨论必须依附：

```text
RepairRecord
```

---

# 44. M4 数据实体

负责：

```text
RepairComment

RepairFavorite

Notification
```

必要时：

```text
CommentMention
```

---

# 45. 评论功能

成员可以：

```text
查看评论

发表评论

回复评论
```

评论关联：

```text
RepairRecord
```

---

# 46. 回复结构

第一版建议：

```text
Comment
 └── parentCommentId
```

支持有限级回复。

不要第一版就实现复杂无限楼中楼。

---

# 47. @成员

评论支持：

```text
@Member
```

系统识别 Mention 后生成通知。

---

# 48. 通知

第一版支持：

```text
被 @

自己的维修记录被评论

自己的维修记录审核通过

自己的维修记录被退回
```

状态：

```text
UNREAD

READ
```

---

# 49. 收藏

成员可：

```text
收藏维修记录

取消收藏

查看我的收藏
```

建议唯一约束：

```text
userId + repairRecordId
```

不得重复收藏。

---

# 50. 疑难 / 典型案例

M4 可以提供前台展示能力。

标记权限由 M6 / 权限系统控制。

字段属于 RepairRecord 或独立关系，由架构负责人确定。

---

# 51. M4 页面

负责：

维修详情中的：

```text
评论区域
回复区域
@成员
收藏按钮
```

独立：

```text
/member/favorites

/member/notifications
```

---

# 52. M4 验收

必须跑通：

```text
成员 A 创建维修记录

成员 B 打开详情

成员 B 评论

成员 B @成员 C

成员 C 收到通知

成员 C 阅读通知

成员 C 收藏记录
```

---

# 53. M5：数据统计与排行榜

建议分支：

```text
feat/p2-analytics
```

依赖：

```text
M2
```

---

# 54. M5 目标

统一第二期所有正式统计口径。

禁止：

```text
工作台自己 count

排行榜自己 count

首页再写一个 count
```

必须统一统计逻辑。

---

# 55. M5 数据规则

所有正式统计：

```text
WHERE status = APPROVED
```

并排除：

```text
deletedAt != null
```

的数据。

---

# 56. 个人统计

提供：

```text
总维修数量

本月维修数量

本学期维修数量

累计维修时长
```

可选：

```text
故障分类分布

月份维修趋势
```

---

# 57. 排行榜

至少：

```text
本月

本学期

总榜
```

指标：

```text
维修数量
```

可切换：

```text
维修时长
```

---

# 58. 学期定义

学期不能散落在页面代码。

建议统一：

```text
SemesterConfig
```

例如：

```text
2026-FALL
```

以及：

```text
startDate

endDate
```

具体是否做数据库配置由团队决定。

---

# 59. M5 API

例如：

```text
GET /api/stats/me

GET /api/stats/ranking

GET /api/stats/overview

GET /api/stats/trend
```

实际路径按项目规范。

---

# 60. M5 验收

构造：

```text
APPROVED
PENDING
REJECTED
DRAFT
```

四种维修记录。

确认：

> 只有 APPROVED 进入统计。

并保证：

```text
个人统计

排行榜

首页数据
```

使用相同口径。

---

# 61. M6：管理后台

建议分支：

```text
feat/p2-admin
```

依赖：

```text
M1
M2

后期接入 M4
```

---

# 62. M6 页面

至少：

```text
/admin/members

/admin/repairs

/admin/categories

/admin/export
```

可增加：

```text
/admin/skills
```

---

# 63. 成员管理

管理员：

```text
新增成员

编辑成员

禁用成员

重置密码

设置角色

设置技能标签

查看成员统计
```

创建成员：

```text
QQ号
初始密码
姓名 / 昵称
角色
```

---

# 64. 维修审核

管理员可以：

```text
查看待审核记录

审核通过

审核退回

填写退回原因

修改异常数据

标记疑难案例

标记典型案例
```

---

# 65. 分类管理

管理员：

```text
新增分类

修改分类

停用分类
```

对于已有维修记录使用过的分类：

> 不建议直接物理删除。

---

# 66. 评论管理

管理员可以：

```text
查看评论

删除违规评论
```

采用软删除。

---

# 67. 数据导出

管理员可以：

```text
筛选维修记录
        ↓
导出
```

支持：

```text
CSV

Excel
```

导出字段至少：

```text
维修日期

维修成员

故障分类

维修结果

维修时长

审核状态

创建时间
```

图片使用：

```text
URL / Record ID
```

不直接嵌入 Excel。

---

# 68. 管理员操作审计

以下行为必须留痕：

```text
审核

退回

修改维修记录

删除维修记录

禁用成员

重置成员密码
```

可统一进入：

```text
AuditLog
```

---

# 69. M6 验收

管理员能够跑通：

```text
创建成员
↓
成员提交维修
↓
管理员审核
↓
审核通过
↓
进入正式统计
```

以及：

```text
筛选维修记录
↓
导出 Excel / CSV
```

---

# 70. M7：官网公开数据接入

建议分支：

```text
feat/p2-public-stats
```

依赖：

```text
M5
```

---

# 71. M7 目标

把第二期真实维修数据接入第一期公开官网。

M7 不重新计算统计。

只消费：

```text
M5
```

提供的数据。

---

# 72. 首页展示

可以展示：

```text
累计维修设备数

本学期维修数量

累计维修时长
```

其中最重要的数据可以进行大字号展示。

例如：

```text
1,286

累计服务设备
```

---

# 73. 首页排行榜

可展示：

```text
本学期 TOP N
```

例如：

```text
01  用户 A  26

02  用户 B  21

03  用户 C  18
```

---

# 74. 隐私规则

禁止公开：

```text
QQ号

后台 ID

登录账号

私人联系方式
```

排行榜展示名称支持：

```text
姓名

昵称

隐藏
```

最终展示策略由管理员配置。

---

# 75. M7 验收

确认：

```text
新增 APPROVED 维修记录
        ↓
M5 统计变化
        ↓
官网数据自动变化
```

同时：

```text
PENDING
REJECTED
DRAFT
```

不能影响公开数据。

---

# 76. 模块开发并行方案

推荐开发顺序：

## 第一阶段

```text
M0
```

优先完成公共契约。

---

## 第二阶段

并行：

```text
M1 Auth

M2 Repairs
```

---

## 第三阶段

M2 核心接口稳定后并行：

```text
M3 Dashboard

M4 Community

M5 Analytics
```

---

## 第四阶段

```text
M6 Admin

M7 Public Stats
```

---

# 77. 推荐 Merge 顺序

建议：

```text
M0
↓
M1
↓
M2
↓
M3 / M4 / M5
↓
M6
↓
M7
```

M3 / M4 / M5 相互独立时可以分别 PR。

---

# 78. 分支规范

统一使用：

```text
feat/p2-m0-foundation

feat/p2-auth

feat/p2-repairs

feat/p2-member-dashboard

feat/p2-community

feat/p2-analytics

feat/p2-admin

feat/p2-public-stats
```

禁止多人共用同一个 Feature Branch。

---

# 79. 开发前同步

每名成员开始任务：

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c feat/xxx
```

如果已经存在自己的开发分支：

```bash
git fetch origin
git rebase origin/main
```

多人协作不要长期脱离 main。

---

# 80. Git 安全要求

禁止：

```bash
git reset --hard
git clean -fd
git push --force
```

Rebase 已推送分支后确需更新：

```bash
git push --force-with-lease
```

不得使用普通：

```bash
--force
```

---

# 81. PR 原则

一个 PR 只负责一个模块。

禁止：

```text
开发评论系统
+
顺手重构 Header
+
改主题
+
改 Repair Schema
+
更新首页
```

形成超大 PR。

---

# 82. 公共 Schema 修改流程

如果 M4 发现 RepairRecord 需要增加字段，应先搜索所有 Schema / Type / Service / API 消费者，
并在 PR 中说明：

```text
模块：
M4

需要新增：
RepairRecord.xxx

原因：
xxx

影响：
M2 / M5 / M6
```

不强制单独评审。若影响 M2 / M5 / M6，则同一变更必须同步：

```text
schema.prisma
新增前向 Migration（不得修改历史 Migration）
公共 Enum / Type / API Contract
所有受影响 Service、Route 与调用方
升级、单元、Contract 与集成测试
相关文档
```

无法同步贯通时不要先合入半套契约，应通过 Issue / PR 明确阻塞依赖。

---

# 83. API Contract

模块之间优先依赖明确 Contract。

例如 M3 不直接：

```text
自己查询 RepairRecord 全表
```

而是尽量通过统一 Service：

```text
getMemberStats()

getRecentRepairs()
```

M7：

```text
getPublicOverview()
```

这样未来内部实现变化时，不需要修改多个页面。

---

# 84. 推荐项目领域结构

实际根据现有 Next.js 项目调整，可以考虑：

```text
src/
├── app/
│
├── components/
│
├── features/
│   ├── auth/
│   ├── repairs/
│   ├── members/
│   ├── community/
│   ├── analytics/
│   └── admin/
│
├── lib/
│   ├── auth/
│   ├── db/
│   └── permissions/
│
├── config/
│
└── types/
```

重点不是必须使用该目录，而是：

> 模块边界必须清楚。

---

# 85. Theme 要求

第二期所有页面继续使用一期 Theme System。

禁止：

```css
color: #2457ff;

background: #ffd400;
```

这类业务组件直接写主题品牌色。

继续使用：

```text
Semantic Token
```

确保：

```text
Normal

Dark
```

都能正常使用。

---

# 86. 各模块禁止事项

## M1 禁止

为了实现登录：

```text
顺手重构 Member Dashboard
```

---

## M2 禁止

为了维修记录：

```text
自己实现排行榜
```

---

## M3 禁止

为了工作台：

```text
自己复制一套统计 SQL
```

---

## M4 禁止

为了评论：

```text
重写 RepairRecord Schema
```

---

## M5 禁止

为了统计：

```text
直接修改首页 UI
```

---

## M6 禁止

为了后台：

```text
重新实现权限系统
```

---

## M7 禁止

为了展示数据：

```text
重新计算排行榜
```

---

# 87. Definition of Done

每个模块完成前至少：

```text
功能完成

权限校验完成

错误状态完成

Loading 状态完成

Empty 状态完成

Mobile 可用

Normal Theme 可用

Dark Theme 可用

无明显 Console Error

lint 通过

build 通过
```

如项目存在：

```text
typecheck

test
```

也必须通过。

---

# 88. PR 提交报告

每个模块 PR 需要说明：

```text
模块名称

完成内容

新增页面

新增 API

新增数据表

Schema 修改

公共文件修改

测试结果

已知问题

依赖模块
```

---

# 89. 集成验收流程 A：维修主流程

最终必须完整跑通：

```text
管理员创建成员
        ↓
成员 QQ号 + 初始密码登录
        ↓
首次修改密码
        ↓
进入工作台
        ↓
创建维修记录
        ↓
上传照片
        ↓
填写维修日期 / 时长 / 分类 / 结果
        ↓
保存
        ↓
提交审核
        ↓
管理员审核通过
        ↓
个人正式统计更新
        ↓
排行榜更新
        ↓
官网累计维修数更新
```

---

# 90. 集成验收流程 B：内部交流

```text
成员 A 打开维修记录
        ↓
发表评论
        ↓
@成员 B
        ↓
成员 B 收到通知
        ↓
成员 B 查看记录
        ↓
回复评论
        ↓
收藏记录
```

---

# 91. 集成验收流程 C：退回

```text
成员提交记录
       ↓
管理员发现信息有误
       ↓
REJECTED
       ↓
成员收到通知
       ↓
修改记录
       ↓
重新提交
       ↓
管理员 APPROVED
```

确认：

> 被退回期间不计入任何正式统计。

---

# 92. 集成验收流程 D：数据删除

测试：

```text
APPROVED Record
        ↓
管理员软删除
        ↓
普通维修列表消失
        ↓
正式统计同步排除
        ↓
数据库历史数据仍然存在
```

---

# 93. 集成负责人职责

建议指定一名：

> Phase 2 Integration Owner

其职责不是包办开发，也不是所有公共契约修改的强制审批人。

主要负责：

```text
Schema

公共 Type

Enum

API Contract

模块依赖

Merge 顺序

Migration

最终集成
```

---

# 94. 数据契约负责人重点关注

尤其防止出现：

```text
M2：

RepairRecord.userId


M3：

RepairRecord.memberId


M5：

RepairRecord.ownerId
```

这种多人 Agent 开发非常容易发生的“代码都能写，但是契约完全不统一”的问题。

---

# 95. 第二期最终交付形态

最终应形成：

```text
Public Website
      │
      ├── 官网公开数据
      │
      ▼
Analytics
      ▲
      │
Repair Records
      │
 ┌────┼───────────┐
 │    │           │
Auth Community   Admin
 │
 ▼
Member Dashboard
```

---

# 96. 最重要的开发原则

第二期多人协作优先级：

```text
统一数据契约
>
模块边界
>
权限正确
>
维修主流程完整
>
数据统计一致
>
多人并行效率
>
额外功能
```

尤其：

> **页面可以各自开发，数据库 Schema、Enum、公共 Type 和 API Contract 不能让各个 Agent 自己决定。**

维修记录必须成为所有统计、排行榜、评论、审核和公开数据的唯一业务数据源。

最终目标不是简单做出多个页面，而是形成一套可以长期继续扩展的：

> **电脑医院成员服务与维修数据平台。**
