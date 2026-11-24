# AgentForge Projects 产品设计

组织项目工作区 · 参考 GitHub Projects · 2026-11-24

## 当前交付

- 组织与仓库均可进入项目目录。新建项目、保存视图、添加条目、编辑字段和发布进展使用当前标签页的独立页面。
- 项目工作区支持表格、看板、路线图、保存视图和 CSV 导出。组织内可跨仓导入 Issue 与 PR，草稿转换保留条目 ID 和项目字段。看板列支持拖动、键盘选择和直接添加条目。
- 组织 Owner / Admin 管理项目、视图、字段和工作流。Member 编辑条目与发布进展，Viewer 只读。旧单仓项目保留原有范围。来源状态与项目 Status 分开存储，项目操作不改变交付审批或合并权限。
- 内置工作流支持条目默认状态、Issue 关闭、PR 关闭与 PR 合并。显式选择的新增列优先于默认规则，重复导入保留已有条目字段。来源规则随事务执行，只响应实际状态变更，关闭项目与归档条目不参与。已有项目的来源规则默认关闭。
- 洞察展示筛选后的当前状态与迭代分布，以及全项目最近最多 30 天的 UTC 日末状态计数。历史从项目创建或迁移日起计算。接入仓库级权限后，历史聚合须同时过滤来源条目。

实现范围为组织项目。下文的项目与团队 ACL、仓库级条目可见性、条件自动添加、定时自动归档、工作流运行审计、来源时间线事件、个人与公开项目、跨组织内容和直接跟踪未发布 PR 的 Changeset 属于后续设计。

## 1. 产品行为

Project 归组织所有，用于跨仓库收集、排序和跟踪工作。项目可以包含 Issue、Pull Request 和项目草稿。项目内的表格、看板、路线图都是同一批条目的保存视图。一个 Issue 可以加入多个项目，每个项目分别维护它的计划状态、优先级和排期。

GitHub Projects 参考行为见[产品概览][github-overview]、[添加条目][github-items]、[保存视图][github-views]和[仓库关联][github-repositories]。AgentForge 沿用自己的导航、组件、主题和交付流程。初始支持组织项目及同组织仓库内容，个人项目、跨组织内容和公开分享纳入独立扩展阶段。

### AgentForge 当前起点

| 已有能力 | 新方案的落点 |
| --- | --- |
| `/projects` 同时渲染真实 Issue 项目列表和演示工作区 | 真实组织项目目录替换该页面，通过旧入口跳转 |
| 项目已有稳定 ID、组织内编号、可选仓库和 Issue 关联 | 保留项目 ID、编号和 Issue 链接，增加项目条目、视图、字段、访问权限 |
| Issue 创建和详情支持项目关联，仓库 Issue 支持按编号预填 | 继续使用现有入口和 `projects=组织/编号` 语义，底层统一读写项目条目 |
| 仓库 PR 和组织 Changeset 已具备来源详情，PR 信息存于 Changeset | 先接入真实 PR，通过实际 PR 编号打开来源。后续允许直接跟踪尚未发布 PR 的 Changeset |

[现有入口](../../apps/web/src/app/RouteElements.tsx) · [Issue API 契约](../../contracts/openapi/issues.yaml) · [项目数据迁移](../../backend/api/internal/platform/postgres/migrations/031_issue_projects.sql) · [交付模型](../../backend/api/internal/delivery/changeset.go)

## 2. 页面与入口

| 页面 | 当前路径 | 核心操作 |
| --- | --- | --- |
| 组织项目目录 | `/orgs/:org/projects` | 浏览开启、已关闭的项目，搜索标题或编号，新建项目 |
| 新建项目 | `/orgs/:org/projects/new` | 选择空白布局或模板，填写项目名称并提交 |
| 项目默认视图 | `/orgs/:org/projects/:number` | 打开首个按顺序排列的保存视图 |
| 保存视图 | `/orgs/:org/projects/:number?view=:viewId` | 查看、过滤、排序、分组和编辑项目条目 |
| 项目归档、工作流、洞察、设置 | `/orgs/:org/projects/:number?page={archive,workflows,insights,settings}` | 管理归档、规则、洞察及字段 |
| 仓库项目页 | `/orgs/:org/repositories/:owner/:repo/projects` | 查看和关联同组织的项目，进入同一项目详情 |
| 旧入口 | `/projects` | 按现有组织选择规则跳转，保留登录后的返回位置 |

项目详情链接固定在 URL 指定的组织。切换组织时前往新组织的项目目录，避免把旧组织的项目编号解释为新组织的项目。视图分享使用稳定视图 ID，重命名、调整标签顺序后链接仍有效。新增路由时同步更新导航、路由测试和 ADR-008。

### 目录与创建

```text
工作台 / 工程组织 / 项目                                   [新建项目]
[开启 3] [已关闭 1]      [搜索项目名称或编号]             [最近更新 ▾]
项目                              关联仓库                   最近更新
#12  发布与交付                   api / web                   今天
#08  平台缺陷归集                 core                        昨天
```

目录使用紧凑行列表。项目标题打开默认视图，行内显示编号、描述摘要、可见的关联仓库和最近更新时间。

「新建项目」在当前标签页转到独立页面 `/orgs/:org/projects/new`。组织入口和仓库入口共用该页，仓库入口预填来源仓库。页头提供返回入口和「新建项目」标题。桌面左栏选择空白布局或模板，右栏填写项目名称和可选的初始配置。窄屏按同样顺序堆叠。提供团队待办和发布计划模板，配置对应的初始保存视图。页面结构参考 [Primer 创建模式][primer-create]和 [PageHeader][primer-header]，布局与模板选择流程参考[新建项目][github-create]。

```text
‹ 返回项目
新建项目
为工程组织创建项目，集中跟踪跨仓库工作。
────────────────────────────────────────────────────────────
选择起点                         项目配置
从空白开始                       项目名称（必填）
● 表格                           [ 发布与交付                  ]
○ 看板                           所属组织  工程组织 · 私有项目
○ 路线图                         默认仓库（可选）
从模板开始                       [ 选择仓库                 ▾ ]
○ 团队待办                       □ 导入所选仓库的现有条目
○ 发布计划                       ──────────────────────────────
                                 [创建项目] [取消]
```

- 默认选中表格，项目为私有。组织从路由读取，无需重复选择。没有可写仓库时仍可创建组织项目和草稿。
- 从仓库入口创建时，提交操作同时关联来源仓库并设置默认仓库。默认仓库用于预填新建 Issue 的目标，用户可在 Issue 表单切换到其他可写仓库。管理员也可手动关联多个仓库。解除关联会保留项目条目。勾选导入后显示成功和失败数量，失败项可重试。后续自动添加由项目工作流单独配置。参见[仓库关联][github-repositories]。
- 「取消」回到对应的组织或仓库项目列表。「创建项目」提交期间显示进度并阻止重复提交。失败保留选择和已输入内容，字段错误就地展示并聚焦首个错误字段，表单级错误在顶部展示。成功后直接进入新项目的默认视图。

### 项目工作区

```text
工程组织 / 项目 / 发布与交付 #12                         [项目详情] [···]
[待办表格] [本期看板] [发布路线图] [+ 新视图]
[过滤工作项 · status:In progress]           [视图选项 ▾] [添加条目 ▾]
标题                         来源      项目状态      优先级    迭代
○ 支持跨仓搜索                api#42    进行中        P1       Sprint 8
◇ 优化搜索索引                web#18    待办          P2       Sprint 8
□ 校验发布范围                草稿      待办          P2       —
```

项目详情面板展示简短描述、Markdown README、关联仓库、默认仓库和最近一次项目进展。点击条目标题打开预览，提供进入来源详情的链接。草稿预览在项目内编辑。设置菜单按权限提供字段、访问、工作流、归档和关闭等入口。加载时保留标题和标签位置，列表用占位行。空项目把焦点放在「添加条目」。无筛选结果提供清除条件，加载失败在失败区域提供重试，失效视图提供返回默认视图。采用现有主题 token、共享按钮、对话框、侧栏和空状态，文案覆盖 `zh-CN` 与 `en-US`。窄屏下目录行堆叠，条目预览全屏，表格和时间轴各自在容器内滚动。键盘可打开条目、操作单元格和移动卡片。关闭弹窗或预览后将焦点还给触发控件。

## 3. 从录入到交付

| 操作 | 行为与结果 |
| --- | --- |
| 添加现有 Issue / PR | 在项目里按仓库、类型、标题或编号搜索并多选，也可粘贴 AgentForge 来源链接。服务端解析同源路由并验证组织、仓库、对象和权限。重复添加返回已有条目，归档条目提供恢复入口 |
| 从来源页加入项目 | Issue 和 PR 详情侧栏列出有权查看的项目及该条目的项目状态。可写用户可添加、移除或更新项目字段。Issue 创建页保留当前选择和预填入口 |
| 创建草稿 | 快速输入标题，随后可补正文、负责人和项目字段。草稿保存在项目中，在转换为 Issue 时应用仓库侧权限和通知规则 |
| 新建 Issue | 从项目进入现有 Issue 创建流程，预填默认仓库和项目。从按 Status 分组的列发起时，预填对应项目状态 |
| 将草稿转为 Issue | 选择可创建 Issue 的仓库，提交后原条目保留 ID、排序、项目字段和历史，来源更新为新 Issue。创建与转换在同一事务完成，重试返回已生成的 Issue |
| 归档、恢复、移除条目 | 归档暂时从工作视图收起，保留字段和历史。恢复使用原条目。移除删除本项目中的关联，来源 Issue 或 PR 仍可访问 |
| 关闭、重新开启项目 | 关闭后移入已关闭列表，保留链接和历史，项目内容只读并暂停自动化。重新开启后恢复写入。永久删除经项目管理员确认后仅清理项目自有数据 |

在 Issue 和 PR 时间线展示加入、移除项目与修改项目 Status 的事件。事件对可读取该项目的用户可见，自动化事件标明执行身份。

GitHub 的条目入口和生命周期见[添加条目][github-items]、[转换草稿][github-convert]、[归档条目][github-archive]和[关闭项目][github-close]。

## 4. 字段和视图

| 字段类型 | 示例 | 写入规则 |
| --- | --- | --- |
| 来源字段 | 标题、仓库、负责人、标签、里程碑、Issue 状态、PR 状态 | 读取来源当前值。支持的行内编辑调用来源 API 并校验来源写权限。其他字段从来源详情编辑 |
| 项目字段 | Status、Priority、Estimate、开始日期、目标日期、Iteration | 保存到本项目的条目。字段支持文本、数字、日期、单选和迭代。选项用稳定 ID 存储，重命名后现有值保持关联 |
| 项目进展 | 进展顺利、有风险、偏离计划及 Markdown 更新 | 有项目写权限的用户发布更新，可填写项目开始日期与目标日期，记录作者和发布时间。目录和项目头部显示最新一条 |
| 交付摘要 | 当前 Revision、Evidence 结果、Review 决策、合并状态 | 从真实交付记录读取，标记来源 Revision，并链接对应的 Changeset 或 PR |

默认工作项状态为待办、进行中、完成，项目管理员可改名和调整顺序。更改项目工作项状态通过项目 API 写入这一个项目。来源状态通过对应 Issue 或 PR API 变更。项目进展通过更新记录发布。GitHub 参考见[项目字段和视图][github-overview]、[项目进展][github-updates]。

| 视图 | 布局 | 关键交互 |
| --- | --- | --- |
| 表格 | 标题固定在首列，可选字段跟随，支持分组与排序 | 单元格编辑、批量修改和归档。手动排序只在没有启用字段排序时可用 |
| 看板 | 默认按 Status 分列，支持按合适的单选字段或迭代分组，空值集中展示 | 跨列拖动更新该分组字段，提供键盘和菜单的「移动到」操作。同列拖动使用手动排序 |
| 路线图 | 左侧工作项，右侧按开始日期、目标日期或迭代绘制时间轴 | 日期字段支持拖动或菜单编辑。仅有目标日期时显示节点，缺少排期的工作项集中显示。按迭代排期时按迭代范围绘制 |

视图支持新建、复制、改名、重排和删除，至少保留一个保存视图。筛选条件支持关键词及 `is:pr`、`repo:api`、`assignee:@me`、`status:"进行中"`、`iteration:@current` 等限定词，并用可访问的筛选控件提供同样的操作。临时筛选、排序和分组属于当前访问者，修改后在标签显示未保存标记。拥有写权限的用户可保存或还原共享配置。工作项字段在提交后直接保存，切换视图能看到同一值。参见[布局][github-layout]、[筛选][github-filter]、[管理视图][github-views]。

```text
本期看板
待办  2                       进行中  1                     完成  1
┌ 优化搜索索引             ┐ ┌ 支持跨仓搜索             ┐ ┌ 修复登录跳转             ┐
│ web#18          P2       │ │ api#42          P1       │ │ web#15          P1       │
└─────────────────────────┘ └─────────────────────────┘ └─────────────────────────┘
[+ 添加条目]                 [+ 添加条目]                 [+ 添加条目]

发布路线图                   11 月 23 日   11 月 30 日    12 月 7 日
支持跨仓搜索                 [──── Sprint 8 ──────]
优化搜索索引                       [───────────────]
发布验证                                                 ◆ 目标日期
未排期  ▸ 校验发布范围
```

## 5. 权限、自动化和更新

| 权限 | 能力 |
| --- | --- |
| 组织 Owner / Admin | 创建项目。对项目有管理权，按仓库策略访问来源内容 |
| 项目 Admin | 管理协作者、可见性、项目字段、关联仓库、工作流和关闭状态。项目所有权归属组织 |
| 项目 Write | 编辑可见条目的项目字段、添加工作项、保存共享视图、发布项目进展和归档。编辑来源须有对应资源的写权限 |
| 项目 Read | 浏览项目、使用已保存视图和临时筛选，读取有权访问的源条目 |

项目私有，组织基础权限默认 Read，协作者可追加 Read、Write、Admin，项目 Admin 可收紧组织基础权限。项目读取和来源读取分别鉴权。无权读取的源条目从结果集省略，计数、筛选选项、图表、归档、搜索候选和导出均遵守相同规则。个人与团队授权采用同一权限判定，团队授权接入实际成员关系后开放。公开分享涉及单独的组织策略与访问验收。GitHub 参考见[管理访问][github-access]和[可见性][github-visibility]。

从来源详情管理项目关联时，使用项目条目接口，校验来源读权限和项目写权限。Issue 创建表单附加项目时，在事务中同时校验 Issue 创建权限、目标项目写权限和仓库范围。现有 `project_ids` 由此逐步切换到项目级授权。负责人、标签和里程碑等来源字段仍按 Issue 权限校验。现有批量替换关联的兼容路径只变更调用者获准修改的集合，隐藏项目的关联不进入该集合。

| 工作流 | 初始配置 | 行为 |
| --- | --- | --- |
| 条目加入 | 默认状态为待办 | 分组明确传入状态时优先应用该值 |
| Issue / PR 关闭，或 PR 合并 | 新项目启用，可分别关闭 | 将该项目条目移到完成。PR 关闭和合并使用来源事件，不推测交付结果 |
| 自动添加 | 按仓库和筛选条件主动配置 | 处理配置启用后的创建和更新事件。历史数据提供明确的批量添加入口 |
| 自动归档 | 主动配置 | 定期扫描符合状态和时间条件的工作项，归档数据可恢复。恢复操作开启新的归档计时 |
| 按项目状态关闭 Issue | 后续可选模板，默认关闭 | 启用者和执行身份必须有来源操作权限，调用现有 Issue 关闭逻辑。规则出错时保留项目状态和可重试的运行记录 |

事件消费记录规则、来源事件和目标条目，重复投递只执行一次，旧事件不得覆盖已处理的新来源状态。手动移除后，重新符合规则的后续来源事件可以再次添加。项目关闭后暂停执行，项目规则审计保留触发条件、结果和失败原因。参考[内置工作流][github-workflows]、[自动添加][github-auto-add]和[自动归档][github-auto-archive]。

洞察基于当前访问者可见的工作项和统一筛选规则。首批提供按状态、负责人、迭代的统计，历史趋势使用字段变更和条目生命周期事件。模板保存字段、视图、草稿、洞察配置和适用的规则。实例化后生成独立项目与字段 ID，管理员可针对目标仓库新建自动添加规则。导出使用当前可见的条目，应用选定视图的筛选与字段顺序。参见[洞察][github-insights]和[项目概览][github-overview]。

## 6. 数据和 API 设计

| 数据 | 归属与约束 |
| --- | --- |
| `Project` | `organization_id + id` 标识，`organization_id + number` 唯一。编号关闭、删除后也不重用。记录标题、描述、README、生命周期、默认仓库和版本 |
| `ProjectRepositoryLink` / `ProjectAccess` | 仓库关联与访问授权独立。使用组织作用域的外键或等效约束，避免跨组织引用 |
| `ProjectItem` | 稳定 ID、来源种类、来源引用、项目内排序、归档时间和版本。同项目同来源唯一，草稿允许多个不同条目 |
| `ProjectField` / `ProjectItemValue` | 字段定义和字段值按项目约束。写入验证类型和选项。删除字段时清理对应视图配置，确认提示受影响的视图和规则 |
| `ProjectView` | 稳定 ID、布局、可见列、排序、分组、过滤及时间轴字段。保存使用版本检测 |
| 更新、规则和条目事件 | 分别保存项目进展、自动化配置、运行记录及关键修改，供审计和历史图表使用 |

PR 条目引用真实 PR 对应的内部交付记录，校验 PR 已存在，页面链接使用仓库路径和 PR 编号。若后续直接跟踪 Changeset，继续用稳定 Changeset ID 绑定。该 Changeset 发布 PR 后，原条目补充 PR 入口。同项目添加该 PR 时复用已有条目，保留计划字段。新增 Revision 时，交付摘要读取新的当前 Revision，过期 Evidence 和 Review 随来源规则失效。审批和合并继续走原有服务端校验，项目状态和自动化均无权授权交付操作。

### 当前 API

统一前缀 `/api/v1/organizations/{organizationID}/issue-projects`。组织内用编号定位项目，条目、字段和保存视图使用稳定 ID。

| 操作 | 接口 |
| --- | --- |
| 项目列表、创建、详情 | `GET/POST /`，`GET /{number}` |
| 设置、关闭、重开、视图、工作流和仓库关联 | `PATCH /{number}`，提交当前项目 `version` |
| 删除项目 | `DELETE /{number}?version=…` |
| 条目列表、添加与编辑 | `GET/POST /{number}/items`，`PATCH/DELETE /{number}/items/{itemID}` |
| 归档、恢复、草稿转换 | 条目 `PATCH` 接受 `archived`，`POST /{number}/items/{itemID}/convert` 转换草稿 |
| 字段与进展、状态历史 | `/{number}/fields`，`/{number}/items/{itemID}/field-values`，`/{number}/updates`，`GET /{number}/status-history` |

写入沿用会话与 CSRF 校验。项目与条目各自使用版本检测，保存视图及工作流配置共用项目版本。过期写入返回 `409`。CSV 由页面按当前筛选结果生成。请求参数和错误语义见 [OpenAPI](../../contracts/openapi/issues.yaml)。

### 兼容迁移

1. 对现有项目增量补齐生命周期、默认视图和字段。保留原 ID、编号、名称及历史的重名范围。对仓库级项目回填关联仓库和默认仓库，并保存原单仓约束，避免升级后自动拓展可选范围。管理员可在设置里明确升级为跨仓项目。
2. 将现有 Issue 关联回填为项目条目，按组织、项目和 Issue 唯一键幂等迁移。已迁移条目保留来源的真实开关状态，项目 Status 默认为未设置，管理员可批量补齐计划状态。
3. 旧 `/issue-projects`、Issue 写入与项目预填切换到同一条目存储或其兼容投影。旧选择器继续筛选仓库范围，归档关联仍可展示，关闭项目退出新选择候选。迁移验收比对每组织项目 ID、编号、关联集合与刷新后的 UI。
4. 项目和仓库关联解耦后，删除仓库时清理仓库入口和默认仓库引用。有权限的项目管理员仍可访问项目及其中其他有效条目。来源已删除的条目可由项目管理员清理。Issue 在同组织转仓时，组织项目中的条目通过稳定来源 ID 保持关联。原单仓项目继续应用现有转仓约束，移除不再符合范围的关联。

## 7. 实施顺序和验收

以下为原设计的实施顺序。已交付阶段 1 和阶段 2 的组织规划工作区，阶段 2 的授权和管理历史仍为后续范围。

| 阶段 | 可独立验收的交付 |
| --- | --- |
| 1 · 项目工作区 | 组织目录、仓库入口和兼容迁移。可通过独立页面新建项目，跨仓添加 Issue、PR，创建和转换草稿。表格与看板共享字段，支持保存视图、归档和重新开启 |
| 2 · 完善规划与自动化 | 路线图、日期与迭代、模板、工作流、项目进展和洞察。设置页补齐团队授权和管理历史 |
| 3 · 扩展协作与交付 | 直接跟踪无 PR 的 Changeset，展示当前 Revision 的交付证据。个人项目、跨组织条目和公开分享按各自权限模型上线 |

- **创建页面。** 从组织和仓库入口进入同一独立路由，验证直接访问、取消返回、仓库预填、字段报错保留输入、提交防重复及成功后的默认视图跳转。
- **跨仓和多项目。** 在仓库入口关联既有项目，进入相同项目 URL。添加两个仓库的 Issue 或 PR。把同一个 Issue 加入第二个项目，在第一个项目改状态，第二个项目保留原状态。
- **同步和生命周期。** 看板跨列移动反映到表格，来源标题更新反映到所有可见视图。草稿转换只创建一次 Issue。归档、恢复、关闭、重新开启和刷新后，字段和链接可恢复。
- **访问边界。** 对照组织 Owner、项目 Writer、Reader 和无权用户。私有仓库条目、筛选值和聚合数字对无权用户不可见。项目写权限不能修改只读来源。组织切换不复用旧编号。
- **交付边界。** 状态设为完成后，仍验证当前 Revision 的 Evidence 和 Review。新 Revision 上线后，旧审批和旧证据不能授权合并。
- **失败与并发。** 分开显示加载、空项目、无筛选结果、权限拒绝和可重试错误。双客户端并发编辑、重复投递、失效视图和外部来源删除都走明确的恢复路径。
- **界面。** 验证浅色、深色、中英文、320 px 视口、键盘移动卡片、弹窗焦点归还、深链接和刷新。

[github-overview]: https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects
[github-create]: https://docs.github.com/en/issues/planning-and-tracking-with-projects/creating-projects/creating-a-project
[primer-create]: https://primer.style/product/scenario-patterns/create/
[primer-header]: https://primer.style/product/components/page-header/
[github-repositories]: https://docs.github.com/en/issues/planning-and-tracking-with-projects/managing-your-project/adding-your-project-to-a-repository
[github-items]: https://docs.github.com/en/issues/planning-and-tracking-with-projects/managing-items-in-your-project/adding-items-to-your-project
[github-convert]: https://docs.github.com/en/issues/planning-and-tracking-with-projects/managing-items-in-your-project/converting-draft-issues-to-issues
[github-archive]: https://docs.github.com/en/issues/planning-and-tracking-with-projects/managing-items-in-your-project/archiving-items-from-your-project
[github-close]: https://docs.github.com/en/issues/planning-and-tracking-with-projects/managing-your-project/closing-and-deleting-your-projects
[github-layout]: https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/changing-the-layout-of-a-view
[github-views]: https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/managing-your-views
[github-filter]: https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/filtering-projects
[github-access]: https://docs.github.com/en/issues/planning-and-tracking-with-projects/managing-your-project/managing-access-to-your-projects
[github-visibility]: https://docs.github.com/en/issues/planning-and-tracking-with-projects/managing-your-project/managing-visibility-of-your-projects
[github-workflows]: https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-built-in-automations
[github-auto-add]: https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/adding-items-automatically
[github-auto-archive]: https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/archiving-items-automatically
[github-insights]: https://docs.github.com/en/issues/planning-and-tracking-with-projects/viewing-insights-from-your-project/about-insights-for-projects
[github-updates]: https://docs.github.com/en/issues/planning-and-tracking-with-projects/sharing-project-updates
