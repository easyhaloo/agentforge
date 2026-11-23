# 仓库注册、代码提交与 Issue 验收

使用本机 Chromium、真实 Go API、PostgreSQL 和 Git。注册新账号，准备一份含 `README.md` 的本地 Git fixture。被测业务写入通过页面发起。负责人使用已注册的组织成员，标签与里程碑通过真实 API 准备。网络监听校验页面收到的响应，Git 只读命令核对提交内容和分支。

| 用例 | UI 操作路径 | 预期结果 |
| --- | --- | --- |
| REG-00 | Repositories → New repository → 选择 README、Node `.gitignore` 和 MIT License → 创建 → 返回创建页并输入同名 | 返回 `201`，Git 初始提交包含三份文件。重复名称阻止提交。 |
| REG-01 | Repositories → New repository → Register an existing repository → 将 Owner 留空 → Register repository | 注册页提示 Owner 无效，无注册请求。 |
| REG-02 | 注册页 → 输入正确 Owner 和名称 → 输入不存在的默认分支 → Register repository | 返回 `422`，页面解释仓库和分支必须可用，保留输入。 |
| REG-03 | 注册页 → 将默认分支改回 `main` → 选择 Private 和 Fork → Register repository | 返回 `201`，进入仓库，初始 README 可浏览。 |
| REG-04 | 回到注册页 → 输入已注册的 Owner 和名称 → 返回仓库列表 | 同名提示出现，提交按钮禁用。列表只存在一条同名记录。 |
| CODE-01 | 仓库 Code → Open WebIDE → 打开 README | 无 Changeset 时内容只读，保存禁用。 |
| CODE-02 | Changesets → 选择刚注册的仓库 → Create changeset → Revisions → 添加 `main` → Overview → 在 WebIDE 打开 → README | Changeset 持久化并绑定初始 Git SHA，编辑器可编辑，未修改时保存禁用。 |
| CODE-03 | WebIDE 修改 README → Reset → 取消 → Save revision → 重读 Changeset 和文件 | 取消保留草稿。保存创建新 Git SHA 和新 Revision，Changeset ID 不变。默认分支仍指向原 SHA，提交中的文件与编辑一致。 |
| CODE-04 | 在另一标签页预先打开同一初始 Revision → 主标签页先保存 → 旧标签页修改 README 并保存 | 旧版本返回 `409` 并保留草稿。从 Changeset 详情重新打开 WebIDE 可读取新 Revision 的文件。 |
| ISSUE-01 | Issues → New issue → Preview → Write → 输入空白标题及描述 → Cancel → Keep editing → 再次 Cancel → Discard | 创建页自动聚焦标题。空预览有提示，空白标题无法发布。保留编辑时草稿仍在，放弃后回到空列表。 |
| ISSUE-02 | 直接打开创建页 → 输入标题和 Markdown → Preview → Write → Create issue → 刷新详情 | 预览显示标题、代码、任务列表、软换行、emoji、提示块和可展开的详情。切回正文可继续编辑原文。收到 `201`，刷新详情后渲染结果一致。 |
| ISSUE-03 | 详情 → Edit → Close issue → 刷新 → Closed issues → Reopen issue → Open issues → 搜索 | 编辑和状态持久化，重开后可通过 Open 列表和搜索找回。 |
| ISSUE-04 | New issue → 勾选 Create more → 填写内容 → Ctrl+Enter → 再次填写标题和同仓引用 → Preview → 点击 Issue 编号 → Keep editing → Create issue | 收到两次 `201`。第一次清空表单、保留选项并聚焦标题。点击 `#1` 提示保留或放弃草稿。第二次取消勾选 Create more 后进入新建详情，刷新仍可解析 `#1` 和 `GH-2`。 |
| ISSUE-05 | 提交时模拟一次 `503` → 请求等待期间再次按提交快捷键 → 查看错误 → 重试 | 每次提交最多发送一个请求。第一次失败保留草稿，重试通过真实 API 收到 `201`。 |
| ISSUE-06 | 直接打开未注册仓库的创建页 → 填写标题 → Create issue | 真实 API 返回 `404`，页面显示错误并保留草稿。 |
| ISSUE-07 | 390px 深色窗口打开创建页 → 输入 501 字符标题 → 用工具栏切换加粗、编号列表、插入链接和多行代码 → 填满正文后再应用格式 → 用方向键切换预览 → 点击 Issues → Keep editing | 标题保留 500 字符。工具栏可以切换格式，插入链接后可直接填写 URL。浏览器不支持原生插入时，格式仍可应用并保留 65536 字符正文上限。预览剔除脚本和危险链接，保留安全的折叠区与脚注，长代码不撑宽页面。草稿继续保留。 |
| ISSUE-08 | 以仓库所在组织的管理员打开 New issue → Assign yourself → 打开元数据并确认已选中当前账号 → 选择标签、里程碑与类型 → Create issue → 刷新详情 | `201` 返回这四项，刷新后仍可读取。已删除或当前仓库不可用的选项返回 `422`，没有新增 Issue，草稿可修正后重试。普通成员可创建 Issue，提交预设关联返回 `403`。 |
| ISSUE-09 | 打开带标题、正文、负责人、标签和里程碑的创建链接 → 确认编辑值 → 预览 → 提交 → 刷新详情 | 查询参数预填草稿，重复标签合并。提交通过真实 API 持久化。 |
| ISSUE-10 | 输入现有 Issue 的标题和 99 字符描述 → 补到 100 字符 → 点击相似 Issue → Keep editing → 提交 | 99 字符时没有建议。达到阈值时最多显示 3 条同仓搜索结果。建议链接触发草稿保护，保留编辑时仍能提交。 |
| ISSUE-11 | 打开包含已删除标签的创建链接 → 检查提示和标题 → Cancel → Discard | 过时属性不被应用，标题保留，可修正后继续编辑。 |
| ISSUE-12 | 注册同组织第二个仓库 → 在第二仓创建 `#1` → 回到当前仓输入 `owner/repo#1`、`#1` 和 `owner/repo@SHA` → Preview → 发布并刷新 → 点击跨仓链接 | 两个编号相同的 Issue 分别链接到正确仓库。限定 SHA 跳转到第二仓的初始提交并显示 README 差异。不存在的仓库和代码里的 Issue 引用保留原文。 |
| ISSUE-13 | 将 WebIDE 生成的完整 SHA、同仓限定 SHA 和短 SHA 粘贴到正文 → Preview → 点击提交链接 → Keep editing → 发布并刷新 → 点击提交链接 | 三种引用都指向同一个完整 SHA。草稿保护保留原文。不存在的 SHA、Changeset ID 和代码中的 SHA 保留原文。发布后可进入实际 Git 提交详情。 |
| ISSUE-14 | 在测试仓库的创建页粘贴同名 GitHub 仓库的提交 URL、带 diff 锚点的 URL、自定义文本链接和其他主机的 URL → Preview → 发布并刷新 | 原始提交 URL 显示七位 SHA 并保留原目标和锚点。自定义链接文本、其他主机及其他仓库的链接保持原样。 |
| ISSUE-15 | 从已发布 Issue 的 WebIDE 提交链接打开提交详情 → 点击父提交 → 查看初始提交的文件差异 | 初始提交没有父提交。差异以空树为基准，显示初始新增的 README。 |
| ISSUE-16 | 输入包含 SHA 的 Markdown → 拦住提交历史查询 → 打开 Preview | 查询超时后正文仍可渲染，未解析的 SHA 保留原样。 |
| ISSUE-17 | New issue → 用键盘为选中文字应用 Markdown 格式 → 用 `⌘/Ctrl+Shift+P` 切换 Write / Preview → 在 Preview 用 `⌘/Ctrl+Enter` 提交 → 刷新详情 | 格式与工具栏一致。切换后焦点进入预览或返回正文，草稿保留。提交返回 `201`，刷新后保留格式。 |
| ISSUE-18 | 在 Write 选中文字后用纯文本快捷键粘贴 → 普通粘贴 URL → 在正文已达上限时粘贴 HTML 表格 → 缩短正文后重试 → Preview → 提交并刷新 | 纯文本快捷键交给浏览器原生处理。普通粘贴为选中文字添加链接并转换表格，超限时保留草稿。发布后仍显示链接和表格。 |
| ISSUE-19 | New issue → 粘贴已存在的同仓和同组织跨仓 Issue URL → 加入不存在的编号、其他组织和站点的链接及自定义文案 → Preview → 发布并刷新 → 点击跨仓编号 | 存在的裸链接缩写为编号，锚点与目标保留。保留未知目标、其他组织和其他站点的原链接，以及自定义文案。发布前点击已验证链接触发草稿保护，发布后可直达目标。 |
| ISSUE-20 | 准备 GitHub `main` 的本地镜像 → Repositories → Register repository → 打开镜像仓的 New issue → 输入上游 SHA → Preview → 发布并刷新 → 点击短 SHA | 仓库注册与 Issue 发布通过真实 API 持久化。预览和发布后的正文显示短 SHA，链接打开的完整 SHA 与 GitHub 一致，提交页面显示对应差异。 |
| ISSUE-21 | New issue → 粘贴 GitHub 上存在的 Issue 和 PR 裸链接、带评论锚点的 PR 链接、不存在的编号和自定义链接 → Preview → 发布并刷新 | 公开 Issue 和 PR 显示 `#n` 或 `owner/repo#n`，跳转到对应类型。评论锚点可访问。未知编号、查询失败、自定义文案和非 GitHub 主机链接保留。 |
| ISSUE-22 | New issue → 输入公开 GitHub Issue、PR 裸链接及自定义文案链接 → Preview → 悬停并移动指针到卡片 → Tab 聚焦链接 → Escape → 发布并刷新 → 再聚焦链接 | 显示仓库和编号、标题、打开 / 关闭 / 已合并状态。链接仍可导航，卡片可悬停、可用 Escape 关闭。未知或无法访问的引用不显示卡片。窄屏保持可读。 |
| ISSUE-23 | New issue → 正文输入 `#` → 按编号或标题片段筛选 → 方向键选择并按 Enter，或点击候选 → 输入 `:rocket` 的前缀并按 Tab → Preview → 发布并刷新 | 候选来自当前仓库。只替换光标处正在编辑的引用。预览和发布后的 Issue 链接均指向原记录，emoji 正常渲染。 |
| ISSUE-24 | New issue → 输入不存在的引用 → 输入查询并模拟服务错误 → 延迟旧查询的响应，先完成新查询 → 继续打字 → Escape → 在已有正文的光标位置重新触发 → 切换 Preview → 回到 Write | 无匹配、查询失败、过期响应或关闭菜单时均保留正文和焦点。菜单不会影响普通编辑、切换预览和提交。 |
| ISSUE-25 | New issue → 正文输入文字 → 用 Tab 进入格式工具栏 → End 聚焦 Reference → Enter 打开候选 → Escape → 在正文开头选中文字 → 点击 Reference → 输入已有编号 → 选择现有 Issue | 编辑器带回焦点。插入 `#` 或用 `#` 替换选区，候选来自当前仓库，选区以外的正文不变。 |
| ISSUE-26 | New issue → 正文新行输入 `/` → 选择 Alerts 并选择 Warning → 输入 `/table` 并用方向键选择 5 列 → 插入 Code block 和 Details → Undo → 重做 → Preview | 菜单展开后可用方向键、Enter、Tab 和鼠标选择。Escape 退回上一级。插入只修改当前命令，保留前后正文。预览显示警告块、五列表格、代码块和折叠区。未知命令和 URL 保持原样，正文长度不足时不改写。 |
| ISSUE-27 | New issue → 输入公开仓库的 `owner/repo#n`、同组织仓库引用、未知编号、限流编号及代码段里的引用 → Preview → 发布并刷新 | 公开简写链接到实际 Issue 或 PR，同组织记录优先。未知、限流及代码段保持原文。与裸链接共用最多 8 个外部查询。 |
| ISSUE-28 | New issue → 输入 `:ship` 并选择 `:shipit:` → 加入标准 emoji、未知短码和代码段中的短码 → Preview → 发布并刷新 | 建议显示图标和短码；预览和详情显示 GitHub 自定义图标及标准 emoji，未知和代码段中的短码保持原样。 |
| ISSUE-29 | New issue → 输入有权和无权查看的跨组织 Issue 裸链接 → Preview → 发布并刷新 | 有权且存在的 Issue 缩写并保留查询和锚点。无权及不存在的 Issue 保留原始链接。 |
| FILE-01 | New issue → Attach files → 选择本地文本、粘贴图片 → Preview → Create issue → 刷新详情 | Write 插入 Markdown，Preview 显示图片和下载链接。创建后图片仍能加载，下载字节与选择的文件一致。 |
| FILE-02 | New issue → 将文件拖入正文或粘贴图片 → Preview → Write → 删除一个附件链接 → 提交 | 拖放和粘贴使用同一上传入口。仅正文仍引用的本次上传写入 Issue。 |
| FILE-03 | 输入标题 → 选择超限文件或不支持的格式 → 选择有效文件 → 上传失败后重试 | 失败时显示提示，保留草稿。上传等待期间不能提交，成功后可继续。 |
| FILE-04 | 选择附件 → 首次提交 Issue 失败 → 重试 → 刷新详情 | 附件保持在草稿，可随重试提交。下载必须使用有权限的会话。 |
| FILE-05 | 在 Go HTTP 合同测试中用两位成员和两个组织访问附件，再尝试将过期或跨仓草稿随 Issue 发布 | 草稿只有上传者可读。过期、跨仓或跨成员绑定返回 `422` 并回滚整次创建。发布后其他组织成员可下载，跨组织不可读取。 |
| FILE-06 | New issue → 上传 SVG、WebM、MP4 和 MOV → Preview → 播放 → 发布并刷新详情 → 再次播放并下载 | SVG 在预览和详情均显示，响应带沙箱策略。两处均可播放 WebM，支持 H.264 的浏览器还可播放 MP4 和 MOV。三个视频的下载字节与原文件一致。内容与扩展名不符的 WebM 返回 `422`，草稿保留。 |
| FILE-07 | New issue → 输入正文 → Preview → Attach files → 选择 SVG → 确认预览 → Write → 发布并刷新 | 预览保持打开并显示新图片。Markdown 附件追加到已有正文末尾。发布后附件仍可读取。 |

WebIDE 保存通过 Changeset 创建新 Revision 和 Git 提交。验收同时核对新提交的父 SHA、文件内容以及 `main` 分支引用。仓库注册、代码提交和 Issue 的创建及后续操作使用同一组织和仓库。ISSUE-05 通过浏览器拦截注入一次失败，重试请求进入真实 API。ISSUE-07 使用模拟数据检查纯前端展示与操作。

在已运行本地业务栈时执行，从仓库根目录进入前端应用后运行。按实际栈设置端口与 Git 根目录。

```bash
cd apps/web
WEB_PORT=4173 AGENTFORGE_TEST_ORIGIN=http://127.0.0.1:4173 \
  GIT_REPOSITORY_ROOT=/tmp/agentforge-dev/git npm run test:e2e -- local-issues.pw.ts
```

使用系统 Chrome 核对 MP4 与 MOV 的 H.264 播放时，在同一命令设置 `AGENTFORGE_BROWSER_CHANNEL=chrome`。

## 验证结果

- 基线为 2026-11-23 从远端获取的 `origin/main`（`7f083e0e8dd7f1d6159d11124277dda4a9c664cf`）。最终版本在恢复原验收数据库后重跑，系统 Chrome 全量端到端 161 项通过（4.2 分钟），包含表单无障碍校验、同路径模板切换时的草稿保护、写入者和只读者的新建权限，以及 GitHub #8 的实时关联。真实业务链路覆盖仓库注册、WebIDE 保存 Revision、Issue 创建和状态流转，以及预览上传 SVG 后发布和刷新。
- 前端单测 357 项通过，生产构建成功。Go API 编译成功，`go test ./...` 使用独立 PostgreSQL 测试库通过。OpenAPI 入口通过 Redocly 校验，有 16 条警告。
- WebIDE 保存产生可读取的新 Git 提交，父提交指向原始版本，`main` 引用保持原值。Issue 创建返回 `201`，刷新后仍可读取 Markdown 正文、负责人、标签、里程碑和类型。失效标签返回 `422` 且不新增记录，修正选项后重新提交返回 `201`。

- ISSUE-20 经真实 UI 验证通过。注册 GitHub 来源的本地镜像后，预览和发布后的正文均能跳转到上游提交的差异。解析由 `LocalGitProvider` 读取本机镜像，运行时向 GitHub 查询 SHA 的能力仍未验证。
- ISSUE-21 已在真实 Go API 与 GitHub 公开 API 上验证。镜像仓的预览和发布后的正文均显示 PR `#143` 与 Issue `cli/cli#7401`。刷新后记录与两条链接仍可读取。未知编号、查询失败、自定义文案和代码块由 Chromium 覆盖。
- ISSUE-22 在系统 Chrome 中覆盖 390 px 窄屏、鼠标、键盘聚焦和 Escape。浏览器测试为外部引用查询使用固定响应。恢复本机服务后，已发布 Issue 正常加载。GitHub 匿名配额耗尽时返回 `403`，正文保留可点击的原始链接。

- TEMPLATE-06 使用真实注册会话和临时 `member` 关系。配置 `blank_issues_enabled: false` 后，普通成员通过选择页打开空白编辑器并预览。发布返回 `201`，刷新仍可读取正文，元数据控件隐藏。直达链接预填正常，无配置仓库直接打开空白编辑器。TEMPLATE-09 使用真实 `viewer` 会话核对入口与三个直达路径均受限。

## 仓库 Issue 模板验收路径

模板 fixture 保存在已注册仓库的默认分支。模板读取使用该分支的固定提交，发布仍走 Create issue。

| 用例 | UI 操作路径 | 预期结果 |
| --- | --- | --- |
| TEMPLATE-01 | 有 Markdown 模板的仓库 → Issues → New issue → 选择 Bug report → Preview → Create issue → 刷新 | 列出合法模板；标题、正文、可用标签和负责人预填；预览和发布页渲染一致。 |
| TEMPLATE-02 | 打开同仓 `issues/new?template=bug.md&title=...&body=...` → Write / Preview | 显式标题和正文覆盖 Markdown 模板默认值。 |
| TEMPLATE-03 | 打开 `issues/new/choose` → 模板查询失败 → Retry | 出错时显示错误，重试后恢复；无效模板、非默认分支模板和符号链接无法选择。 |
| TEMPLATE-04 | 有模板的仓库 → 选择无效模板链接 → 返回选择页；无模板的仓库 → Issues → New issue | 无效模板链接显示原因和返回入口；无模板仓库进入空白编辑器。 |
| TEMPLATE-05 | 模板编辑器 → 修改文本 → 点击 Change template 或后退到同路径的另一模板 → Keep editing → 再次切换 → Discard | 保留草稿能回到输入，确认放弃后才加载目标模板。仅模板查询参数变化时也保留草稿保护。 |
| TEMPLATE-06 | 配置 `blank_issues_enabled: false` 和 `contact_links` 的仓库 → Issues → New issue → 比较普通成员与维护者视图 | 有写权限的 `member`、`admin`、`owner` 均可选择 Blank issue 并看到 Maintainers only。普通成员可预览和发布，元数据控件仍不可编辑。只读成员见 TEMPLATE-09。 |
| TEMPLATE-07 | 有 YAML Issue Form 的仓库 → 选择表单 → 尝试提交缺少必填项的表单 → 完成表单 → Preview → Create issue | 首次无效提交切回 Write 并聚焦首个缺项。必填控件可读出字段说明与错误信息。补齐后成功发布，刷新后的 Markdown 与预览一致。 |
| TEMPLATE-08 | 选择 Structured report → 填写并上传附件 → Preview → 勾选 Create more → Create issue → 填写第二条 → Change template → Keep editing → 发布 → Change template | 每次发布返回 `201`。下一张表单恢复模板标题、默认选项和类型，清除上一次答案、附件与链接预填。编辑过的草稿受保护，新表单允许直接离开。 |
| TEMPLATE-09 | 只读成员 → 仓库 Issues → 直接打开 `issues/new`、`issues/new/choose` 和 `issues/new?template=bug.md` → Back to issues | 正常读取列表但没有新建入口。三个直达路径均显示权限提示，没有编辑器或提交按钮，返回链接可用。 |
| TEMPLATE-10 | 打开 Blank issue → 在已有草稿中间输入 `/template` → 选 Bug report → Preview | 只插入 Git 中 Markdown 模板的正文。标题和光标两侧的草稿保留，YAML 表单不在候选中。仓库无 Markdown 模板或查询失败时提示原因，关闭菜单后仍可编辑和重试。 |
| TEMPLATE-11 | 退出登录 → 打开包含模板、标题和正文预填的直达链接 → 登录 → Preview | 登录前不渲染编辑器。登录后返回原链接，模板选择和预填值保留，可直接预览。 |
| TEMPLATE-12 | 仓库 Issues → New issue → 在选择页检查 `.github/ISSUE_TEMPLATE`、根目录 `ISSUE_TEMPLATE` 和 `docs/ISSUE_TEMPLATE` → 打开根目录及 docs 模板 → Preview | 读取默认分支的固定提交，三个位置都可用。同名文件按 `.github`、根目录、`docs` 顺序选取。 |
| TEMPLATE-13 | 打开 `issues/new/choose?platform=macOS&logs=trace` → 选择带对应字段 ID 的 YAML 表单 → Preview → 勾选 Create more 并发布 | 只预填匹配的输入框和多行字段。下一条清除 URL 预填并恢复模板默认值。 |
| PROJECT-05 | 打开 `issues/new?projects=组织/编号` → 查看元数据 → 发布并刷新；再用其他仓库的 Project 或无效编号打开 | 有权且当前仓库可用的项目被预选。无效及越界项目显示提示并保留草稿。 |

## 常用回复

| 用例 | UI 操作路径 | 预期结果 |
| --- | --- | --- |
| REPLY-01 | 设置 → 常用回复 → 查看空列表 → 尝试空白标题 → 补齐标题和 Markdown → 保存 → 刷新 → 编辑并再次保存 | 空列表有提示，空白标题不能提交。保存失败保留表单，重试成功后刷新仍可读回。编辑覆盖同一条回复。 |
| REPLY-02 | 切换到另一个账号 → 设置 → 常用回复 | 列表中没有前一个账号的回复。 |
| REPLY-03 | 新建 Issue → 选中正文内的文字 → 工具栏常用回复 → 查询失败并重试 → 筛选 → 插入 → 使用 `/saved-replies` → Preview → Create issue → 刷新 | 无匹配结果有提示。只替换选区或命令文本，编辑器焦点恢复。发布的正文和预览显示同一份 Markdown。 |
| REPLY-04 | 新建 Issue → 填满正文 → 插入常用回复 → Escape | 显示长度上限提示，关闭后原草稿完整保留。 |
| REPLY-05 | 设置 → 常用回复 → 删除 → 取消 → 再次删除并确认 → 刷新 → 返回 Issue 编辑器 | 取消保留回复。确认后删除持久化，编辑器显示空列表与管理入口。 |

## 成员联想

| 用例 | UI 操作路径 | 预期结果 |
| --- | --- | --- |
| MENTION-01 | 新建 Issue → 在正文输入 `@` 和显示名 → 选择候选 → 切换 Preview → 发布并刷新 | 候选使用组织成员的显示名及稳定句柄。预览和发布正文使用同一句柄。 |
| MENTION-02 | 新建 Issue → 输入不匹配的姓名 → Escape → 输入邮件地址 | 空结果有提示，取消保留草稿。邮件地址不会触发候选。 |
| MENTION-03 | 切换为同组织成员 → 打开创建页 → 查询成员和非成员 | 成员可查当前组织的有效成员，非成员和邮箱不会出现在结果中。 |
| MENTION-04 | 分别以作者和同组织的只读成员登录 → 作者在 New issue 选择该成员 → Preview → 收件人打开 Inbox → 作者发布 → 收件人刷新并打开通知 → 返回并刷新 | 预览无通知。发布后只读收件人看到一条未读通知，打开后进入刚发布的 Issue，返回刷新显示已读。 |
| MENTION-05 | 作者在正文重复提及收件人（含大小写变化和加粗），并加入自己、组织外成员、停用成员、邮箱与代码示例 → 发布 → 比较各账号的通知列表 | 只有正文中被实际提及的有效成员收到一条通知。作者、组织外成员、停用成员及仅在邮箱或代码中出现的账号均不收件。 |

Chrome、真实 Go API 与 PostgreSQL 已通过 MENTION-04 和 MENTION-05。以 `AGENTFORGE_TEST_PSQL` 指定连接本机测试库的 `psql` 路径（也接受连接包装脚本），设置 `AGENTFORGE_TEST_ORIGIN` 后执行 `npm run test:e2e -- member-mentions.pw.ts`。测试仅使用 SQL 准备成员关系，注册、发布、打开通知及刷新使用浏览器。

## Changeset 引用验收路径

| Case | UI 操作路径 | 验收点 |
| --- | --- | --- |
| REF-01 | 在完成 WebIDE 提交的仓库中打开新建 Issue → 点击 Reference → 输入 Changeset 标题关键字 → 选择 Changeset → Preview → 发布 → 刷新后点击引用 | 预览与发布正文都链接到同一个 Changeset。短 ID 用于显示，链接携带完整 Changeset ID。 |
| REF-02 | 同仓输入已有 Issue 编号、无法匹配的关键词 → 在另一仓搜索原 Changeset 标题 | 数字仍可匹配 Issue。另一仓不能选到原仓 Changeset。无匹配和请求失败时保留草稿。 |
| REF-03 | 在正文输入 `owner/repo#` 和公开 GitHub PR 编号或标题关键词 → 选择 Pull request 候选 → Preview → 发布并刷新 | 候选只来自明确指定的公开仓库。预览和发布后均链接到正确的 GitHub PR。 |
| REF-04 | 输入普通 `#n` → 在两个外部仓库搜索同一编号 → 输入外部仓库中的 Issue 编号或不存在的 PR → 模拟外部查询失败 → 继续编辑 | 普通引用仍使用同仓记录。切换仓库清除旧建议。远端 Issue 不会当作 PR 插入，无匹配或失败均保留草稿。 |
| REF-05 | 创建真实同仓 PR → 另一位组织成员打开 New issue → 输入 `#` 和 PR 标题关键词 → 选中 Pull request → Preview → 发布 → 初始会话打开并点击引用 | 候选以 Pull request 显示。预览和已发布正文都指向同一个 PR 详情，链接使用完整 Changeset ID。 |

Chrome 全量回归通过 REF-03 和 REF-04。浏览器回归为外部搜索提供固定响应，发布和刷新走真实 Go API 与 PostgreSQL。另用 Chrome 连接公开 GitHub API，在正文输入 `easyhaloo/agentforge#timezone` 选中 PR `#143`，预览、发布、刷新后链接正确。公开 API 的按编号查询触发匿名限流，实际页面保留了草稿并显示暂时不可用提示。按编号返回 PR、排除 Issue 和处理查无结果由 Go 测试及浏览器回归覆盖。

## Issue 项目关联验收路径

| Case | UI 操作路径 | 验收点 |
| --- | --- | --- |
| PROJECT-01 | 打开当前组织的 Projects → 创建组织级项目和仓库级项目 → 新建 Issue → Issue metadata → Projects → 选择两项 → Preview → Create issue → 刷新 | 候选按组织及当前仓库显示。两项随 Issue 一起持久化。已发布的详情可见项目名。 |
| PROJECT-02 | 回到同仓新建 Issue → 打开 Projects → 查看最近使用；进入同组织其他仓库的新建页 | 当前账号用过的项目优先显示。其他仓库只可选择组织级项目和本仓项目。 |
| PROJECT-03 | 切换组织或成员角色 → 查看候选，尝试创建项目和发布带项目的 Issue；测试空白项目名和同范围重名 | 项目不可跨组织或跨仓库关联。仅组织管理员及所有者能创建项目和设置关联。非法关联失败时不创建 Issue。 |

Chrome 已通过 PROJECT-01、PROJECT-02，并验证空白项目名和同范围大小写重名。使用真实 PostgreSQL 的 Go HTTP 集成测试覆盖跨组织、跨仓和普通成员的权限、Recent 的账号隔离，以及非法关联后 Issue 与编号分配回滚。 加入 Projects 后，单 worker 的 Chrome 全量回归通过 151 项。

## GitHub 对照范围

- 参考仓库 `easyhaloo/agentforge` 启用了 Task、Bug 和 Feature，AgentForge 支持这三种类型。登录 GitHub 后核对了空预览、预览里的附件按钮、Create more 的勾选状态，以及 Projects 的 Recent、Repository 和 Organization 分组。GitHub 对照只操作草稿，GitHub 连续发布后的行为未实测。AgentForge 的连续创建已经走完两次真实提交。
- 预填支持 `title`、`body`、`assignees`、`labels` 和 `milestone`。AgentForge 使用同仓标题搜索，正文达到 100 字符后最多显示 3 条结果。本次在 GitHub 草稿输入已有 Issue 的完整标题和超过 100 字符的正文时没有出现建议，未确认排序及匹配算法。
- GitHub 的 Reference 同时列出 Issue 和 PR。AgentForge 的 Reference 联想列出同仓 Issue、拉取请求和普通 Changeset。拉取请求与普通 Changeset 分别打开对应详情，链接使用完整 Changeset ID。公开 GitHub PR 裸链接可以在正文中解析。AgentForge 的 `/` 支持 Alerts、Code block、Details、Table 和插入仓库 Markdown 模板。仓库模板支持 Markdown 和 YAML，使用独立的模板测试仓库验收。常用回复已在 Chrome、Go API 和 PostgreSQL 中验收，覆盖 REPLY-01 至 REPLY-05。`@` 成员联想使用本组织的稳定 `member-N` 句柄，已验证候选、预览、发布和刷新读回。发布时仅为同组织其他有效成员的 Markdown 正文提及写入站内通知。在正文输入 `owner/repo#编号` 或 `owner/repo#关键词` 可搜索该公开 GitHub 仓库的 PR。Projects 页面顶部的 Issue projects 面板连接真实后端，页面下方保留带 Demo 标记的旧演示区。参考仓库的 Git 基线未检出 Issue 模板文件。
- 编辑器支持 GitHub 文档列出的加粗、斜体、代码、链接、列表和引用快捷键，支持键盘切换 Write / Preview 及提交。复用 GitHub 的粘贴处理器，真实页面已验证链接和表格粘贴。
- Markdown 预览和已发布的正文使用同一渲染器。支持标准 emoji 别名、五类提示块、折叠区、脚注，以及同组织的 `#n`、`GH-n` 和 `owner/repo#n` Issue 引用。本地同仓 Git 提交支持完整和短 SHA 引用。同组织其他已注册的本地仓库支持 `owner/repo@SHA`，点击可查看目标仓库的提交详情和初始提交差异。同仓 GitHub 提交 URL 显示短 SHA 并保留原目标与锚点。提交历史查询超时后，预览仍能显示正文和原始 SHA。已验证的同组织 AgentForge Issue 裸链接会缩写为 `#n` 或 `owner/repo#n`，保留目标和锚点。自定义文案、未知编号、其他组织和站点链接保留原样。公开 GitHub Issue 和 PR 裸链接根据 GitHub API 缩写并解析实际类型。支持保留评论锚点。查询成功时，公开 GitHub 引用的标题和状态可通过鼠标悬停或键盘聚焦查看。AgentForge 跨组织引用和自定义 emoji 待实现。
- 附件在选择、拖放或粘贴时上传。PNG、GIF、JPEG 和 SVG 可行内显示，MP4、带 QuickTime 文件类型标记的 MOV 和 WebM 使用浏览器播放器，视频也可下载。Chromium 验证了 SVG 和 WebM。系统 Chrome 验证了 WebM、MP4 和 MOV 在预览和发布后的播放。视频解码取决于浏览器和编码。
- AgentForge 的图片和视频上限为 10 MiB，其他文件为 25 MiB，每条 Issue 最多 20 个附件。草稿只对上传者可见，24 小时后无法访问或发布。发布后仍要求有效会话和仓库访问权限。GitHub 的公开仓库附件允许匿名访问，付费计划的视频上传上限为 100 MB。这两项行为未在 AgentForge 实现。

## 本机验收入口

同一私有测试仓库的页面操作保留了可查记录。通过 Create repository 建仓，在 Changeset 的 Revisions 添加 `main`，再在 WebIDE 编辑并保存 README。点击已发布 Issue 正文的 `a8d29df` 可查看这次提交的差异。Issue 已关闭并重开，两次状态均刷新读回。Git 核对了新增内容和父提交，`main` 仍指向初始提交 `ea2d4b7`。

- [测试仓库](http://127.0.0.1:4219/orgs/4cf3e599e07175a0430d6480521876f5/repositories/4cf3e599e07175a0430d6480521876f5/ui-delivery-walkthrough)
- [Changeset 的两条 Revision](http://127.0.0.1:4219/orgs/4cf3e599e07175a0430d6480521876f5/changesets/76a804a738399ccca7e8e330be5504ce/revisions)
- [WebIDE 生成的 Git 提交](http://127.0.0.1:4219/orgs/4cf3e599e07175a0430d6480521876f5/repositories/4cf3e599e07175a0430d6480521876f5/ui-delivery-walkthrough?change=a8d29df6ae5cc50d09c5b508e0a091a92133143e)
- [已发布的验收 Issue #1](http://127.0.0.1:4219/orgs/4cf3e599e07175a0430d6480521876f5/repositories/4cf3e599e07175a0430d6480521876f5/ui-delivery-walkthrough/issues/1)

在有仓库访问权限的本机浏览器会话中打开 [测试仓库 Issue 创建页](http://127.0.0.1:4219/orgs/4cf3e599e07175a0430d6480521876f5/repositories/qa/issue-preview/issues/new)。通过创建页提交并刷新核验的记录可在 [Issue #1](http://127.0.0.1:4219/orgs/4cf3e599e07175a0430d6480521876f5/repositories/qa/issue-preview/issues/1) 查看。

另一条已发布的验收记录包含 GitHub 上游提交链接。打开后点击短 SHA 可查看提交差异。[本地镜像 Issue #1](http://127.0.0.1:4219/orgs/4cf3e599e07175a0430d6480521876f5/repositories/easyhaloo/agentforge/issues/1)

[本地镜像 Issue #2](http://127.0.0.1:4219/orgs/4cf3e599e07175a0430d6480521876f5/repositories/easyhaloo/agentforge/issues/2) 提供已发布的 GitHub PR 与 Issue 链接验收样例。

通过 [模板选择页](http://127.0.0.1:4219/orgs/4cf3e599e07175a0430d6480521876f5/repositories/qa/issue-templates-walkthrough/issues/new/choose) 选择 Structured report，可试填并预览 YAML 表单。已通过界面发布并刷新核对的样例见 [表单 Issue #1](http://127.0.0.1:4219/orgs/4cf3e599e07175a0430d6480521876f5/repositories/qa/issue-templates-walkthrough/issues/1)。

[普通成员发布的空白 Issue #2](http://127.0.0.1:4219/orgs/4cf3e599e07175a0430d6480521876f5/repositories/qa/issue-templates-walkthrough/issues/2) 可回看关闭公开空白入口后，写入角色预览和发布的结果。

## 可直接复查的本机验收样例

使用已打开的 Chrome「Issue 验收」会话。其他会话需登录并有仓库权限。恢复原数据库后，已复查新建页可切换预览、Issue #1 保留 PR #9 时间线，以及 Issue #2 可打开 README 提交差异。

- [新建与预览](http://127.0.0.1:4219/orgs/fb1e24eeb07b92f66ec47e516f17cbd9/repositories/fb1e24eeb07b92f66ec47e516f17cbd9/issue-walkthrough/issues/new)
- [Issue #1 与 GitHub 时间线](http://127.0.0.1:4219/orgs/fb1e24eeb07b92f66ec47e516f17cbd9/repositories/fb1e24eeb07b92f66ec47e516f17cbd9/issue-walkthrough/issues/1)。发布后同步公开 GitHub #8，刷新仍显示 PR #9 的入站引用。
- [Issue #2 与 WebIDE 提交](http://127.0.0.1:4219/orgs/fb1e24eeb07b92f66ec47e516f17cbd9/repositories/fb1e24eeb07b92f66ec47e516f17cbd9/issue-walkthrough/issues/2)。点击 `26a9150` 打开实际 Git 差异。`main` 保持在 `7fb991a`。

## Issue 详情页走查

对照 GitHub Issue #8 的标头、正文菜单、正文底部动作、时间线、评论区和右栏。使用 AgentForge 的样式与权限模型，在真实 API、数据库和两套浏览器会话中验证以下路径。

| 用例 | UI 操作路径 | 预期结果 |
| --- | --- | --- |
| DETAIL-01 | Issues → 打开详情 → 检查标题、编号、状态、作者、正文和 New issue → 复制页面链接 | 链接能在另一会话打开正确记录。窄屏下正文和操作可用。 |
| DETAIL-02 | 正文菜单 → Copy link → Copy Markdown → Quote reply → Preview | 复制可访问的深链接和原始 Markdown，引文追加到现有草稿并聚焦，预览渲染为引用。取消与剪贴板失败可恢复。 |
| DETAIL-03 | 标题编辑 → 保存 → 正文菜单 → Edit → 保存并刷新 | 标题与正文单独更新。越权和提交失败保留现有内容，旧版本不会静默覆盖写入。 |
| DETAIL-04 | Add a comment → Write / Preview → 发布 → 评论菜单 → 复制、引用、编辑、删除 | 评论在时间线按发生时间显示且刷新可读。空白不能提交。删除有确认，编辑和删除受权限约束。 |
| DETAIL-05 | 正文或评论 → 选择 emoji → 第二会话打开 → 切换撤销 | 反应计数持久化，同一用户与表情只计一次，撤销不影响他人。 |
| DETAIL-06 | 详情 → Close issue（选择原因） → Reopen issue → 查看时间线 → Lock conversation / Unlock | 状态、操作者和顺序可追溯。锁定拒绝无权限评论。 |
| DETAIL-07 | 右栏 → 设置负责人、标签、类型、项目和里程碑 → 刷新 → 清除；只读用户打开同页 | 选择和清除持久化，候选按仓库过滤，只读会话不能修改。 |
| DETAIL-08 | 正文底部 → Create sub-issue / Add existing → 从父子页导航 → 移除 | 创建和关联真实 Issue，拒绝自关联、循环、重复及越权仓库。 |
| DETAIL-09 | 正文底部 → Add artifact → 上传 → 刷新、下载 → 移除 | 文件关联持久化，越界读取和超限上传被拒绝。 |
| DETAIL-10 | 右栏 → 字段、开发关联、订阅与参与者；从另一会话制造活动 | 设置、关系、订阅和参与者由服务端读取。开发关联遵守 Changeset 与 Revision 的模型。 |
| DETAIL-11 | 正文菜单 → Report content；右栏会话管理动作 → 确认或取消 | 举报不改正文且可追踪。有效管理动作检查角色和资源范围，取消不产生写入。 |
| DETAIL-12 | 右栏 → Transfer issue → 选择同组织仓库 → 取消、确认 → 用第二会话打开旧链接 | 取消保留原记录。确认事务性分配目标仓编号，保留正文、评论、附件与历史，旧地址跳转到新位置。仓库专属元数据的清除需在确认前告知。存在父子关系、权限不足或版本过期时拒绝转移。 |
| DETAIL-13 | 右栏 Development → Create pull request → 选择实际 Git 分支 → 比较并发布 → 从 PR 返回 Issue | 使用同仓真实分支。Issue 和 PR 双向关联。没有可比较分支时显示校验，后续合并仍受当前 Revision 的证据和评审约束。 |
| DETAIL-14 | 右栏 Development → Create a branch → 输入名称并选择基准 → 创建 → 刷新 → 另一会话点击分支链接 | Git ref 指向提交时选定的基准 SHA，两个会话均可读取。空仓、非法名称、重名和过期基准均无法创建。 |
| DETAIL-15 | Open in GitHub 区域 → Link a GitHub issue → 填入公开 Issue URL → Sync from GitHub → 刷新及切换会话 → Unlink GitHub issue | 同步入站 PR 链接并持久化。取消操作保留原状态。普通成员不能管理关联。解绑后两个会话都不再显示原链接。 |

DETAIL-12 在 Chrome 中覆盖取消、父子关系阻止转移、另一标签改标题导致 `409`、刷新后重试、以及不同用户访问旧链接并下载转移后的附件。Go HTTP 集成测试另外覆盖跨组织目标、私有转公开、普通成员、并发重复转移以及失败不占用目标编号。DETAIL-13 至 DETAIL-15 使用真实 Git、PostgreSQL 和 GitHub 公开 API。
