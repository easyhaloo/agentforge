# AgentForge 文档规范化总结

**日期**: 2024-11-20  
**变更**: agent.md 废弃，建立结构化文档体系

---

## 执行的变更

### 1. 新增文档

| 文档 | 行数 | 用途 |
|------|------|------|
| **AGENTS.md** | ~450 | 通用AI开发标准（所有AI工具）|
| **CLAUDE.md** | ~300 | Claude Code专属配置 |
| **docs/development/backend.md** | ~450 | Go后端开发规范 |
| **docs/development/frontend.md** | ~550 | React/TypeScript前端开发规范 |
| **docs/_archive/README.md** | ~70 | agent.md废弃说明 |
| **.husky/check-doc-placement** | ~200 | 文档位置检查脚本 |

### 2. 更新的文档

- **README.md**: 更新文档导航，移除agent.md引用
- **.husky/pre-push**: 集成文档位置检查
- **docs/_archive/agent.md.deprecated**: 归档原agent.md（418行）

### 3. 文档位置规则

Pre-push hook现在会自动检查并拒绝以下错误：
- ❌ `backend/api/DEVELOPMENT.md` → 应该是 `docs/development/backend.md`
- ❌ `apps/web/GUIDE.md` → 应该是 `docs/development/frontend.md`
- ❌ `docs/backend-guide.md` → 应该是 `docs/development/backend.md`
- ❌ `ARCHITECTURE.md` → 应该是 `docs/architecture/overview.md`
- ❌ `agent.md` → 已废弃，使用 `AGENTS.md` + `docs/development/`

---

## 新文档架构

```
agentforge/
├── README.md                    # 项目概览（人类开发者入口）
├── AGENTS.md                    # AI通用开发标准（AI agent入口）⭐
├── CLAUDE.md                    # Claude Code配置
├── TESTING.md                   # 测试环境配置
│
├── docs/
│   ├── development/             # 开发规范 ⭐ 新增
│   │   ├── backend.md          # Go后端开发规范
│   │   └── frontend.md         # React前端开发规范
│   │
│   ├── architecture/            # 架构文档
│   │   ├── overview.md
│   │   └── decisions.md
│   │
│   ├── deployment/              # 部署文档
│   ├── operations/              # 运维文档
│   ├── product/                 # 产品文档
│   ├── plans/                   # 规划文档
│   │
│   └── _archive/                # 归档 ⭐ 新增
│       ├── README.md            # 废弃说明
│       └── agent.md.deprecated  # 原agent.md
│
├── backend/api/
│   └── README.md                # API运维文档（部署、配置）
│
└── .husky/
    ├── pre-push                 # Git hooks（含文档检查）
    └── check-doc-placement      # 文档位置检查脚本 ⭐ 新增
```

---

## AI Agent阅读顺序

### 所有AI工具（Cursor, Copilot, Continue, Claude Code等）

```
1. AGENTS.md              ← 必读：核心原则、产品上下文、领域规则
   ├─ 产品定位
   ├─ 领域不变式（Changeset/Revision/Evidence）
   ├─ 通用AI开发标准
   ├─ Git工作流
   ├─ 测试要求
   └─ 文档位置规则

2. docs/development/frontend.md   ← 前端工作时
   ├─ React Router规则（ADR-008）
   ├─ Feature-Sliced架构
   ├─ i18n强制规范
   ├─ 组件化原则
   └─ TypeScript规范

3. docs/development/backend.md    ← 后端工作时
   ├─ Go代码风格
   ├─ 数据库和Migration
   ├─ API设计规范
   ├─ 错误处理模式
   └─ 安全规范

4. CLAUDE.md              ← 如果使用Claude Code
   ├─ 项目特定配置
   ├─ Git提交格式约定
   ├─ Agent角色分工
   └─ 文档位置决策树
```

### 人类开发者

```
1. README.md              ← 项目概览和快速开始
2. TESTING.md             ← 测试环境配置
3. docs/development/      ← 开发规范
4. docs/architecture/     ← 架构文档
```

---

## agent.md 废弃原因

### 问题

1. **职责混淆** (418行混合了4类内容)
   - 通用AI标准 + Claude Code配置
   - 前端规范 + 产品领域规则
   - 没有后端规范

2. **工具锁定**
   - 文件名"agent.md"虽是约定，但内容混合了工具特定配置
   - 其他AI工具（Cursor、Copilot）需要筛选哪些适用

3. **可维护性差**
   - 前端规范变更影响后端开发者
   - 26KB单文件难以导航
   - 前后端规范不平等

### 解决方案

**关注点分离** (Separation of Concerns):

| 关注点 | agent.md | 新结构 |
|--------|----------|--------|
| 通用AI标准 | ✅ 混在其中 | ✅ AGENTS.md（独立） |
| 工具特定配置 | ❌ 混合 | ✅ CLAUDE.md（独立） |
| 前端规范 | ✅ 详细 | ✅ docs/development/frontend.md |
| 后端规范 | ❌ 缺失 | ✅ docs/development/backend.md |
| 产品领域规则 | ✅ 有 | ✅ AGENTS.md（提取） |

---

## 文档位置强制执行

### Pre-push Hook检查

`.husky/pre-push` 现在会：
1. ✅ 检查文档位置合规性（新增）
2. ✅ 检查Go代码格式（原有）
3. ✅ 运行Go测试（原有）
4. ✅ 检查DATABASE_URL（原有）

### 检查规则示例

```bash
# ❌ 这些会被拒绝：
backend/api/DEVELOPMENT.md
apps/web/GUIDE.md
docs/backend-guide.md
ARCHITECTURE.md
agent.md                      # 已废弃

# ✅ 这些是正确的：
docs/development/backend.md
docs/development/frontend.md
docs/architecture/overview.md
AGENTS.md
CLAUDE.md
```

### 绕过检查（不推荐）

```bash
git push --no-verify
```

---

## 迁移检查清单

- [x] 创建 docs/development/backend.md（后端规范）
- [x] 创建 docs/development/frontend.md（前端规范，从agent.md迁移）
- [x] 创建 AGENTS.md（通用AI标准）
- [x] 创建 CLAUDE.md（Claude Code配置）
- [x] 创建 .husky/check-doc-placement（检查脚本）
- [x] 更新 .husky/pre-push（集成检查）
- [x] 更新 README.md（文档导航）
- [x] 归档 agent.md → docs/_archive/agent.md.deprecated
- [x] 创建 docs/_archive/README.md（废弃说明）
- [x] 更新所有内部文档引用（移除agent.md链接）

---

## 后续改进建议

### P1 - 高优先级

1. **创建 CONTRIBUTING.md**
   - PR提交流程
   - 代码审查checklist
   - 行为准则

2. **完善 README.md 开发环境配置**
   - 环境变量完整清单
   - 依赖服务启动顺序
   - 常见问题排查

### P2 - 中优先级

3. **docs/development/git-workflow.md**
   - 详细的Git工作流说明
   - 分支策略详解
   - PR合并策略

4. **.github/PULL_REQUEST_TEMPLATE.md**
   - PR描述模板
   - 测试checklist

5. **CI/CD流程文档**
   - GitHub Actions workflow说明
   - 部署流程

### P3 - 低优先级

6. **docs/architecture/ADR-index.md**
   - 列出所有架构决策记录
   - 快速导航

7. **性能规范**
   - 前端性能基准
   - 后端查询优化

8. **监控和可观测性**
   - 日志规范
   - 指标收集

---

## 验证文档完整性

### 前端开发者需要的文档 ✅

- [x] React/TypeScript规范 → docs/development/frontend.md
- [x] 路由规则（ADR-008） → docs/development/frontend.md
- [x] i18n规范 → docs/development/frontend.md
- [x] 组件化原则 → docs/development/frontend.md
- [x] 测试环境 → TESTING.md
- [x] Git工作流 → CLAUDE.md（详细版待创建）

### 后端开发者需要的文档 ✅

- [x] Go代码规范 → docs/development/backend.md
- [x] API设计 → docs/development/backend.md
- [x] 数据库规范 → docs/development/backend.md
- [x] 错误处理 → docs/development/backend.md
- [x] 安全规范 → docs/development/backend.md
- [x] 测试策略 → docs/development/backend.md
- [x] API运维 → backend/api/README.md

### AI Agent需要的文档 ✅

- [x] 通用开发标准 → AGENTS.md
- [x] 产品领域规则 → AGENTS.md
- [x] 前端详细规范 → docs/development/frontend.md
- [x] 后端详细规范 → docs/development/backend.md
- [x] Claude Code配置 → CLAUDE.md
- [x] 文档位置规则 → CLAUDE.md

---

## 统计数据

| 指标 | agent.md (旧) | 新结构 |
|------|---------------|--------|
| 文件数 | 1 | 4主文档 + 2检查文件 |
| 总行数 | 418行 | ~1750行（更详细） |
| 后端规范 | 0行 | 450行 |
| 文档位置规则 | 0 | 完整决策树 + 自动检查 |
| AI工具支持 | 主要Claude | 通用（所有AI工具） |
| 结构化程度 | 单文件 | 按职责分离 |

---

## 对现有工作流的影响

### ✅ 不会破坏的流程

- CI/CD流程（未修改.github/workflows/）
- Git hooks的其他检查（pre-commit, gofmt, go test）
- 现有代码和测试
- 开发环境配置

### ⚠️ 需要适应的变化

- **AI agent**: 首次读取需要找AGENTS.md，不是agent.md
- **文档更新**: 需要按新结构放置（pre-push会检查）
- **内部链接**: 引用agent.md的地方需要更新（已完成）

### 🎯 带来的改进

- **清晰的文档结构**: 知道去哪里找什么
- **自动合规检查**: 不会再有文档乱放
- **后端规范补全**: Go开发有明确指引
- **工具中立**: 所有AI工具都能使用

---

## 总结

✅ **成功建立了符合agent开发规范的文档体系**

**关键改进：**
1. 关注点分离（AI标准、工具配置、前端、后端）
2. 后端规范补全（从0到450行）
3. 文档位置强制执行（pre-push检查）
4. 工具中立（支持所有AI工具）

**迁移完成度：100%**
- agent.md内容已完整迁移到新结构
- 所有内部引用已更新
- 原文件已归档并说明废弃原因

**立即可用：**
- AI agents可以从AGENTS.md开始工作
- 开发者有清晰的前端/后端规范
- 文档位置错误会在push时被拒绝
