# 根目录清理建议

## 立即执行（P0）

### 1. 移动临时文档到 docs/plans/

```bash
# 移动合并计划
git mv MERGE_PLAN.md docs/plans/merge-plan-phase-2-4-5.md

# 移动实施报告
git mv PHASE5_IMPLEMENTATION_REPORT.md docs/plans/phase5-implementation-report.md
```

### 2. 解决包管理器冲突

**选项A：使用 npm（推荐，已在 package.json 中配置）**
```bash
# 删除 pnpm 相关文件
rm pnpm-lock.yaml pnpm-workspace.yaml
git add -u
```

**选项B：切换到 pnpm**
```bash
# 删除 npm lock 文件
rm package-lock.json

# 更新 package.json scripts 为 pnpm
# 然后运行
pnpm install
```

## 推荐执行（P1）

### 3. 创建缺失的标准文件

```bash
# 如果还没有这些文件：
- CONTRIBUTING.md   # 贡献指南
- LICENSE.md        # 许可证
- CHANGELOG.md      # 变更日志
```

## 清理后的理想根目录

### 标准项目文件
```
README.md              # 项目概览
TESTING.md             # 测试配置
LICENSE.md             # 许可证（如果有）
CONTRIBUTING.md        # 贡献指南（待创建）
CHANGELOG.md           # 变更日志（如果有）
```

### AI指南
```
AGENTS.md              # 通用AI开发标准
CLAUDE.md              # Claude Code配置
```

### 开发配置
```
package.json           # npm配置
package-lock.json      # npm锁定文件（或 pnpm-lock.yaml，二选一）
pnpm-workspace.yaml    # 仅当使用pnpm时保留
Makefile               # 构建脚本
```

### 部署和测试
```
compose.yaml           # Docker Compose
docker-compose.test.yml # 测试环境
wrangler.jsonc         # Cloudflare Workers
playwright.config.ts   # E2E测试配置
```

### 其他必要文件
```
.gitignore             # Git忽略规则
.editorconfig          # 编辑器配置（如果有）
tsconfig.json          # TypeScript配置（如果在根目录）
```

## 清理后预期效果

- ✅ 根目录只有标准配置文件
- ✅ 临时文档移到 docs/plans/
- ✅ 只有一个包管理器的锁定文件
- ✅ 新增的 AGENTS.md 和 CLAUDE.md 符合行业规范
- ✅ 整洁度评分：9/10

## 为什么这样组织

### 根目录应该包含的：
1. **项目元信息**（README, LICENSE, CONTRIBUTING）
2. **开发工具配置**（package.json, tsconfig, prettier等）
3. **AI指南**（AGENTS.md, CLAUDE.md - 行业约定）
4. **部署配置**（docker-compose, Makefile）

### 根目录不应该包含的：
1. ❌ 临时实施报告（应该在 docs/plans/ 或 docs/_archive/）
2. ❌ 合并计划（应该在 docs/plans/）
3. ❌ 多个包管理器的锁定文件（选择一个）
4. ❌ 代码文件（应该在 src/, apps/, backend/ 等）

## 参考：行业最佳实践

### 典型开源项目的根目录：
```
react/
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── CHANGELOG.md
├── package.json
├── package-lock.json
├── .gitignore
└── ... (其他配置文件)

vscode/
├── README.md
├── LICENSE.txt
├── CONTRIBUTING.md
├── package.json
├── yarn.lock
└── ... (其他配置文件)
```

### AgentForge 特色（符合规范）：
```
agentforge/
├── AGENTS.md          ← AI通用指南（AgentForge特色）
├── CLAUDE.md          ← Claude Code配置（AgentForge特色）
└── ... (标准项目文件)
```
