# 管理小鲸鱼机器接口

仅面向管理群的后端集成。已有浏览器Cookie管理接口、ADMIN角色及报名人员接口不变；机器凭证不被这些接口识别。

## 认证和范围

仅下列 `/api/v1/bot/` 路由读取独立 `Authorization: Bearer <token>`。服务器仅保存 SHA-256 摘要：

- `MANAGEMENT_BOT_TOKEN_SHA256`：64位小写十六进制摘要；明文随机token仅在机器人私密文件。
- `MANAGEMENT_BOT_TOKEN_EXPIRES_AT`：带时区的到期时间，必须有效且未过期。
- `MANAGEMENT_BOT_ORIGIN`：负责人实际群消息核实的完整官方QQ UMO。

未配置返回503；凭证错误或到期401；Cookie、Origin和群成员自称管理员均不构成机器身份。撤销：清空摘要并重启；轮换：用新随机token替换两端配置并重启网站。

请求另含 `X-Management-Origin`（须匹配固定配置）、`X-Management-Actor`（实际触发确认的官方用户OpenID，32位hex）。这是可信集成对QQ发起人的断言，不是网站独立验证的QQ登录身份。网站操作人固定为SYSTEM主体 `management-whale`，不伪造User，不授ADMIN；机器权限固定为活动读取、创建、修改标题/容量。机器人群内成员权限不等于AstrBot平台管理员。

## 路由

| 方法  | 路径                                | 内容                                               |
| ----- | ----------------------------------- | -------------------------------------------------- |
| GET   | `/api/v1/bot/repair-activities/:id` | 活动公开字段及版本，不含报名人员、创建人或出勤明细 |
| POST  | `/api/v1/bot/repair-activities`     | 创建；五字段必填；确认后立即公开                   |
| PATCH | `/api/v1/bot/repair-activities/:id` | 仅title/capacity，至少一项                         |
| GET   | `/api/v1/bot/operations/:id`        | 已提交操作的结果，用于超时核查                     |

统一响应沿用 `{success,data,meta:{requestId}}` / 错误信封；所有机器响应禁止缓存。不存在DELETE、改时间、提前截止、导出、成员管理或报名人员读取入口。

创建JSON：`title,capacity,activityAt,signupOpensAt,signupClosesAt`。时间为带Z或±hh:mm的ISO时间，按现有Service核验 `signupOpensAt < signupClosesAt <= activityAt`；标题2–120字符，容量整数1–10000。拒绝未知字段、字符串/布尔容量和超过8KiB的JSON。

响应字段（issue #362）：`data` 额外返回 `location: string|null` 与 `endsAt: string|null`（活动地点与结束时间），历史活动两者为 `null`。创建与更新请求体仍只接受上列字段——机器接口写入地点/结束时间的能力属于后续子任务，本次仅暴露读取。

## 幂等与版本

- POST/PATCH必须带UUID `Idempotency-Key`，与模型调用requestId不同。
- 同一机器主体+操作编号，仅与活动和审计同事务提交成功记录；重复相同请求回原结果，不重复创建/修改，相同编号不同内容409 `IDEMPOTENCY_CONFLICT`。
- 活动增加整数 `version`（存量默认1），普通网站管理端更新和软删除也递增，不依赖毫秒时间戳或内容哈希，A→B→A不会复用版本。
- GET与写响应的 `data.version` 为强ETag格式，例如 `"1"`，GET/PATCH同时返回ETag头。PATCH须原样提供 `If-Match: "1"`；不接受*、版本列表或猜测缺省值。在活动行锁内核验，冲突409且无部分写入。
- 修改容量仍不得小于当前有效报名数；已有事务与锁保持，不绕过业务Service。
- 操作查询成功返回 `data:{state:"succeeded",result:{id,url}}`。查不到返回404，不能据此断言先前请求绝对未执行（仍可能在途），机器人不能自动换编号重发。
- 成功历史结果与活动当前状态区分：操作成功不保证该活动此后未被别人修改或删除。

## 数据与审计

新增 `bot_operations`：主键 `(principal_id,operation_id)`，请求摘要、成功结果、requestId、可信集成提供的确认者OpenID和创建时间。不保存Bearer明文。

活动创建机器主体的 `createdBy=NULL`；审计actorType=SYSTEM，after摘要有servicePrincipal/requestedBy，operation记录绑定同requestId。已有USER审计路径和用户外键保持不变。机器与原管理端复用活动创建/更新事务业务函数，不复制业务规则。

上线前须在隔离_test库应用前向Migration并验证；生产不产生测试活动。机器人先拟稿，用户确认完整最新版本后才访问写入口。网站自身不新增草稿/发布流程。
