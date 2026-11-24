# 通知邮箱与仓库 Webhook 前端设计

## 入口与范围

| 需求 | 入口 | 谁可以配置 |
| --- | --- | --- |
| 接收个人通知邮件 | 个人设置 → 通知 → 默认通知邮箱（`/settings/notifications`） | 当前登录用户 |
| 向外部服务投递仓库事件 | 仓库 → 设置 → Webhooks（`/orgs/:org/repositories/:owner/:repo/settings/webhooks`） | 组织所有者、管理员。普通成员没有菜单入口，直接访问显示权限提示 |

沿用 GitHub 的入口分工和 Primer 的按钮层级，页面使用 AgentForge 现有设置布局。[GitHub 通知配置](https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications) · [GitHub 创建 Webhook](https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks) · [Primer Button](https://primer.style/product/components/button/guidelines/) · [Primer Dialog](https://primer.style/product/components/dialog/guidelines/)

## 个人通知

默认通知邮箱置于「参与」和「关注」之前。两组偏好分别提供站内和邮件选项，勾选后立即保存。邮件服务可用时展示邮件选项，有已验证地址后才可勾选。切换站内选项只写入站内偏好，切换邮件选项只写入邮件偏好。

```text
桌面 · 待验证
设置导航 │ 通知
         │ 默认通知邮箱
         │ 邮箱地址 [________________] [发送验证码 · 次级]
         │ 待验证地址 · name@example.com
         │ 验证码   [________________] [验证邮箱 · 主要]
         │ 参与     □ 站内   □ 邮件
         │ 关注     □ 站内   □ 邮件

窄屏 · 待验证
通知 → 默认通知邮箱
邮箱地址 [________________]
[发送验证码 · 次级]
待验证地址 · name@example.com
验证码 [__________________]
[验证邮箱 · 主要]
参与与关注选项纵向排列
```

| 状态 | 界面与操作 |
| --- | --- |
| 加载中或加载失败 | 显示加载状态或就地重试。邮件配置和站内偏好分别读取，邮件配置读取失败时仍可使用站内偏好 |
| 邮件服务不可用 | 邮箱区显示服务不可用，站内偏好仍可配置 |
| 未设置地址 | 输入邮箱，「发送验证码」为主按钮。发送成功显示已排队和待验证地址 |
| 待验证 | 展开验证码输入，「验证邮箱」为唯一主按钮，「发送验证码」降为次级。更换地址时继续显示服务端返回的原已验证地址 |
| 已验证 | 显示当前地址并启用邮件偏好。再次发送验证码可发起换绑 |
| 提交失败 | 在相关区域显示错误。无效或过期验证码、限流及其他保存失败分别提示，偏好以服务端确认的值为准 |

## 仓库 Webhooks

列表卡片展示 URL、启用状态、订阅事件，以及编辑、投递记录和删除入口。点击投递记录后加载该 Webhook 的最近记录，展示事件、状态、时间和可用的 HTTP 状态码。记录可手动刷新，空记录、读取失败和投递失败有各自的提示。

```text
桌面
仓库设置导航 │ Webhooks             [添加 Webhook · 主要]
             │ https://receiver.example.com/events
             │ 已启用 · 议题创建、议题评论
             │ [编辑] [投递记录] [删除 · 危险]

窄屏 · 编辑
Webhooks
提交地址     [________________]
签名密钥     [________________]
订阅事件     □ 议题创建  □ 议题评论
启用         □
[保存 · 主要] [取消]
```

- 首次进入显示加载状态，读取失败可重试，空列表保留「添加 Webhook」。打开新增或编辑表单后，由「保存」接替列表主按钮。
- 新增填写 HTTPS 地址和签名密钥，至少选择一个事件。事件范围为议题创建和新增议题评论。编辑时密钥输入框为空，留空保留原密钥。校验或保存失败时保留输入，提交期间阻止重复保存。
- 点击「删除」打开危险确认弹窗，提示同时删除投递记录。删除失败时保留弹窗并显示错误。取消或按 `Esc` 将焦点还给触发按钮，删除成功后焦点移到「添加 Webhook」。

## 组件、接口与验收

- 复用 `Button`、`Input`、`Checkbox`、`ConfirmDialog`、设置卡片和现有颜色及间距变量。每个交互状态只强调一个主操作。危险确认使用 `danger`。输入保留可访问标签，事件复选框以 `fieldset` 分组，状态和错误分别使用 `status`、`alert`。按钮组和长 URL 在窄屏换行，文案维护 `en-US` 和 `zh-CN`。
- 个人设置使用 `settingsAPI`。`/api/v1/users/me/notification-preferences` 读写站内偏好，`/api/v1/users/me/notification-email` 读写邮件配置，`/notification-email/verification` 和 `/notification-email/verify` 在同一用户路径下分别发送和验证验证码。服务端返回可用性、已验证地址、待验证地址和邮件偏好。[个人设置 API 客户端](../../apps/web/src/shared/api/settings.ts)
- 仓库使用 `repositoryWebhooksAPI`，通过仓库 `/webhooks` 资源管理订阅，通过 `/{id}/deliveries` 读取记录。服务端负责权限检查、HTTPS 校验和投递状态，密钥只随新增或替换请求提交。[Webhook API 客户端](../../apps/web/src/shared/api/repository-webhooks.ts)
- Chromium 验收覆盖邮箱验证、错误验证码、两种议题事件的邮件投递、管理员和普通成员权限、Webhook 编辑和删除、确认弹窗焦点回退，以及失败投递记录。用桌面和 390px 宽度截图核对主次按钮的实际样式和横向溢出。[端到端用例](../../apps/web/e2e/notification-delivery.pw.ts)
