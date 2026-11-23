# 仓库交付链路修复计划

制定日期 2026-11-23。验收及复核服务版本为 `9d571cc`，方案同时核对了当前规划工作树 `c07711e`。实施前通过 `run/serving-sha` 确认部署版本。验收记录中的 Sxx 和 Txx 对应截图与终端证据编号。

## 优先级与依赖

| 优先级 | 工作项 | 现有证据 | 依赖 |
| --- | --- | --- | --- |
| P0 | 启用组织邀请所需的 OIDC | 接受真实邀请返回 `503 OIDC unavailable`，独立 Reviewer 无法入组。S23 | 测试身份提供方与回调配置，可先行处理 |
| P0 | 统一第一方 Git 仓库为 bare 存储 | 网页新建仓为 non-bare，晋升实现只接受 bare。实测 Promote 在 Review 门禁返回 `409`。S21、T04 | 新仓初始化与存量迁移验证，可和 OIDC 配置同时推进 |
| P0 | 实现第一方 Git Smart HTTP | Git 服务发现失败，网页未提供可用的克隆地址。本机 `file://` push 已证实展示链路可用。S05、T01、T02 | 第一方 bare 存储与 Git 认证契约 |
| P0 | 复验 Changeset 审批与候选晋升 | 当前 Revision 的 Evaluation 已通过，候选 run 成功且队列为 `ready`，缺少独立 Review。S18–S23、T04 | OIDC 与 bare 存储。可用已有 fixture 先验，再在最终走查使用网络 push |
| P1 | 从网页配置并验证 Revision 触发器 | 复核在同版本的仓库 Actions 中确认入口。本轮仅打开对话框，原验收使用数据库订阅跑通触发。S13–S17、S24、T03 | 已发布的仓库工作流与注册 Runner |
| P1 | 自动建立提交与 Issue 的双向关联 | `#1` 写在 commit message，已验证的是评论中的手动 SHA 链接。S07–S08 | 接收真实 push 后产生持久事件。首版约定同仓 `#编号` |

OIDC 配置、bare 存储验证和 Actions 网页订阅复测可并行开始。bare 存储通过回归后接通网络传输，再用真实 push 验证 Issue 关联。OIDC 与 bare 存储就绪后先单独验通晋升，再跑整条交付链。Git 托管实施顺序沿用[原生 Git 托管计划](native-git-hosting.md)。

## P0 启用组织邀请所需的 OIDC

`server.go` 在 OIDC handler 缺失时对邀请接受路由返回 `503`。`cmd/server/main.go` 在未配置 OIDC 或提供方初始化失败时不装配该 handler。`identity/oidc.go` 在回调中核验签名及已验证邮箱，邮箱与邀请匹配时才接受邀请。现有证据确认本机 handler 未就绪。实施时用启动日志确认具体属于配置缺失还是 discovery 失败。

- 为验收环境接入一个可用的 OIDC 测试提供方，按 API README 配置完整参数和匹配 `APP_ORIGIN` 的 callback。测试环境须能完成 state、PKCE 和 Cookie 往返。部署配置通过现有注入方式提供，凭据存放于该环境的密钥配置中。
- 用已有 Owner 创建邀请，由第二个测试身份接受。刷新后核对 active membership、预期角色和审计记录。对过期、已撤销、重放及邮箱不匹配的邀请验证拒绝结果。验证原有密码会话和退出流程。
- 落点为部署配置及 runbook。只有复测识别出代码缺陷时，才调整 OIDC 路由或身份实现，并扩展对应测试。回滚恢复部署配置，撤销未使用的测试邀请。
- 参考 [OIDC 配置](../../backend/api/README.md)、[装配入口](../../backend/api/cmd/server/main.go)、[认证路由](../../backend/api/internal/platform/httpserver/server.go)、[邀请回调](../../backend/api/internal/identity/oidc.go)。

## P0 统一第一方 Git 仓库为 bare 存储

`InitializeRepository` 在持久目录以 `--work-tree=.` 初始化 `.git`，`PromoteCandidate` 则在写入目标 ref 前检查仓库是否为 bare。这项差异已由实仓和代码交叉核对。旧验收的 `409` 来自交付门禁，真实晋升返回值留待复验。

- 保持组织、仓库 ID 和目录映射。通过临时工作区生成初始提交，再发布 bare 仓到正式目录，保留 README、`.gitignore`、License、默认分支和初始化清理行为。覆盖 Code 浏览、Issue 分支、WebIDE Revision、候选构建等现有消费者。
- 存量第一方非 bare 仓先用一份副本演练。暂停目标仓写入，快照旧目录，在隔离 staging 路径构建 bare 版本。逐项核对默认分支、分支、标签、`refs/agentforge/*`、对象可达性和 SHA 后切换。记录工作树未提交数据的处理结果。第三方仓按已有注册或远程适配器处理。
- 执行迁移前建立回滚点。切换前可恢复旧目录。切换后若已接收新写入，先冻结并保存新增 refs 和对象，再执行回滚。回归包括初始化失败清理、迁移前后 refs 一致、重复迁移检查、在网页新建仓上验证队列晋升。
- 落点 [初始化适配器](../../backend/api/internal/delivery/repository_initialize.go)、[初始化测试](../../backend/api/internal/delivery/repository_initialize_test.go)、[晋升适配器](../../backend/api/internal/delivery/candidate.go)、迁移操作文档。

## P0 实现第一方 Git Smart HTTP

架构文档定义了 Smart HTTP 目标路径。复核的路由只提供应用 API 和认证入口，当时的 `info/refs` 从站点入口无法完成 Git 协议发现，直连 API 返回 `404`。仓库 Code/Settings 当时没有可用的 Git clone URL。

- 依既有架构引入 `git-http-backend` 适配层，覆盖服务发现、clone/fetch、push。补齐部署代理和 Code 页 Clone 控件，输出与配置 origin 一致且不携带凭据的 URL。无传输能力的仓库展示明确状态。
- 使用仓库范围、可撤销、有有效期的 Git 访问凭据。服务端校验活动成员、仓库访问权、读写授权与保护分支策略，保留审计。子进程使用固定可执行文件、受控环境、流量及时间限制。先确认凭据管理入口和默认分支策略，再落地 API 契约及负向测试。远离 loopback 使用 HTTPS。
- 保存成功更新的 repository、actor、ref、old/new SHA，用可重试的持久事件供后续关联处理。拒绝的更新保持 ref 不变。重复投递不产生重复副作用。异常中断后能核对 Git refs 并补记事件。
- 实测从 Code 页复制地址，用标准 `git clone`、`git fetch`、`git push` 更新测试 Issue 分支。另一 checkout 从网络读到相同 SHA，网页可浏览差异和文件。分别覆盖无权限访问、撤销凭据、默认分支保护和成功重试。通过部署开关回滚新增传输入口，保留已经接受的 Git 提交和审计。
- 落点 [Git 架构](../architecture/native-git-hosting.md)、[仓库服务路由](../../backend/api/internal/platform/httpserver/server.go)、[Vite 代理](../../apps/web/vite.config.ts)、[部署 Worker](../../apps/web/src/worker.ts)、[仓库页面](../../apps/web/src/pages/repositories/RepositoryDetailPage.tsx)。

## P0 复验 Changeset 审批与候选晋升

从网页添加活动 Revision，核对 CI 成功事件与 Git SHA。运行 Evaluation，用独立 Reviewer 批准该 Revision，再由 Owner 或 Admin 晋升已经成功构建的候选。核对队列为 `promoted`、晋升回执恰好一条、Git `main` 等于候选 SHA、Changeset 留下同一 Revision 的合并记录，以及 Code 页显示提交文件。

先用独立 bare fixture 验证门禁正向路径，再在网页新建仓和迁移后的旧仓复验。负向覆盖缺证据、自审、旧 Revision Review、候选目标 ref 已变化。保留失败机器原因与 `main` 指向。Actions 工作流中的手工审批记录和 Changeset Review 分别核对。

落点 [晋升事务](../../backend/api/internal/platform/postgres/integration.go)、[Changeset 门禁](../../backend/api/internal/delivery/changeset.go)、[晋升集成测试](../../backend/api/internal/platform/postgres/integration_test.go)。

## P1 复验网页 Revision 订阅

`仓库 → Actions → 选中左侧已发布工作流 → Triggers → Changeset revision`。复核在验收版本打开了对话框，并看到了 `Enable trigger`。保持现有 API 和组件，先补真实后端走查，再依实测决定是否有入口可发现性问题。

- 以 Owner 从网页启用订阅并刷新核对绑定版本。新增 Revision，Actions 应出现唯一的 `changeset_revision` run，核对 Changeset ID、Revision ID 和完整 Git SHA。网页禁用订阅后再新增 Revision，核对该订阅未触发新 run。
- 覆盖 Viewer 写入被拒、草稿和缺失必填输入默认值的状态。沿用现有的 owner/admin 控制和双语文案。
- 落点 [Actions 页面](../../apps/web/src/pages/repositories/RepositoryActions.tsx)、[触发器对话框](../../apps/web/src/pages/repositories/WorkflowTriggers.tsx)、[触发器 API](../../backend/api/internal/platform/httpserver/pipeline.go)、[真实 API 回归](../../apps/web/e2e/repository-actions.pw.ts)。

## P1 提交与 Issue 的结构化关联

按同仓 `#编号` 作为首版规则。在成功的 Git push 事件处理过程中解析新提交中引用的真实 Issue，按组织、仓库、Issue 和完整 SHA 做幂等关联。Issue 的 Development 区展示关联提交，提交详情提供 Issue 回链。既有 Markdown SHA 链接继续工作。关联仅记录提及，Issue 状态由原有操作控制。

验收用例为推送一条引用 `#1` 的提交，刷新后从两侧均可导航。覆盖重复事件、同一提交推到两条分支、未知 Issue 和跨组织访问。保持 Commit SHA、Changeset ID 与 Revision ID 的独立语义。落点为 Git push 事件消费者、Issue 持久层、[Issue Development](../../apps/web/src/pages/repositories/IssueDetailSidebar.tsx) 与[仓库提交页](../../apps/web/src/pages/repositories/RepositoryBrowserPage.tsx)。

## 最终回归与证据

- 后端使用测试数据库运行 `cd backend/api && go test ./... && go build ./cmd/server`。前端运行 `cd apps/web && npm test && npm run build && npm run test:e2e`。复用现有仓库和 Actions 用例并覆盖各工作项的正向与负向断言。参考 [测试环境](../testing/setup.md)、[浏览器验收](../testing/e2e.md)、[仓库交付回归](../testing/repository-delivery-walkthrough.md)。
- 在实际部署入口从密码登录、网页建仓、创建 Issue、网络 push、提交关联，一直走到 Changeset、网页配置触发器、Actions CI、独立 Review 与 Promote。CD 验收目标为候选晋升到 `main`。外部部署验收需要另外明确目标环境和产物。
- 保存 Clone 入口和网络 push 输出、Issue 与提交双向链接、活动 Revision、Triggers、CI 日志、独立 Review、队列与最后的 `main` SHA。将截图与部署 SHA、Changeset ID、Revision ID、run ID 和候选 SHA 一起归档。

## 实施及验收状态

2026-11-23，修复版在 `127.0.0.1:43177` 使用隔离 PostgreSQL、Git 存储和 Dex 通过本地交付验收。网页密码登录及邀请入组、网页建仓、真实 Git clone/push/fetch、Issue 与完整 SHA 双向链接、Changeset 与活动 Revision 关联、Actions CI、独立 Review 和 `main` 晋升均有截图或日志。直推默认分支和已撤销凭据在实测中均被拒绝。Actions 订阅网页停用与不再触发在真实后端浏览器回归中验证。

新建第一方仓已统一为 bare。旧仓副本完成迁移、refs 比对、`fsck` 和回滚演练，常驻环境仍需按[迁移手册](../operations/git-bare-migration.md)执行。验收结束后恢复常驻服务。正式启用需合入修复、安排迁移窗口、配置实际 OIDC 提供方并开启 Smart HTTP。CD 验收终点为 Git `main`。
