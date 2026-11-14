# 维护文档目录

本目录保留持续维护的工程规范、公共契约和功能操作说明。新人先看[项目首页](../README.md)与[贡献指南](../CONTRIBUTING.md)，工程与验证规则以 [AGENTS.md](../AGENTS.md) 为准。

## 工程与公共契约

| 内容                                | 文档                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| 页面场景、主题与交互                | [设计系统](design-system.md)                                                          |
| 目录职责、Service / Repository 边界 | [架构](architecture.md)                                                               |
| 数据库、Migration、测试隔离         | [数据库指南](database.md) · [Windows 环境](database-windows.md)                       |
| 数据语义与约束                      | [数据契约](contracts/data-contract.md)                                                |
| HTTP 接口与错误口径                 | [API v1](contracts/api-v1.md)                                                         |
| 前端遥测、E2E 巡检与无障碍基线      | [可观测性](observability.md)                                                          |
| 分支、提交、评审与合并              | [Git 工作流](git-workflow.md)                                                         |
| 第二期原始需求背景                  | [需求设计](第二期需求分析文档.md)（历史设计背景；后续变化以现行契约和已合并实现为准） |

## 功能与维护

| 内容                                 | 文档                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 邮箱绑定、换绑、管理员协助与密码找回 | [邮箱管理](email-management.md)                                                                                |
| 邮箱访问规则与开关                   | [邮箱门禁](email-gate-rollout.md)                                                                              |
| 建档邮件任务与 worker                | [账号通知](account-notifications.md)                                                                           |
| 后台表格结构与接入                   | [表格内核](admin-table-kernel.md)                                                                              |
| 表格查询与导出规则                   | [查询规则](table-query-plan.md) · [能力清单](table-capabilities.md)                                            |
| 维修草稿退役与定时清理               | [草稿处理](repair-draft-retirement.md)                                                                         |
| 管理小鲸鱼接口与权限边界             | [管理接口契约](contracts/management-bot.md)                                                                    |
| 客服小鲸鱼活动排队引导               | [Web 能力与 bot 配置交接](customer-whale-queue-handoff.md)                                                     |
| 发布、恢复与结果通知                 | [部署 Skill](../.agents/skills/zafu-pchospital-deploy/SKILL.md) · [通知配置](../tools/deploy/NOTIFICATIONS.md) |
| 独立文档站同步                       | [docs-sync](../tools/docs-sync/README.md)                                                                      |

`assets/` 只保留中英文 README 共用的浅 / 深色首页预览；临时截图和验证产物放仓库外。

## 历史记录

早期里程碑任务书、交付报告、一次性调研与已废弃规划已从当前目录移除，避免与现行规则混用；原内容仍在 Git 历史中，不重写历史、不在仓库内另存归档副本。

需要追溯时，在仓库根目录查询：

```bash
git log --all --diff-filter=D --name-status -- docs
git log --all -- path/to/removed-file.md
git show <保留该文件的提交>:path/to/removed-file.md
```
