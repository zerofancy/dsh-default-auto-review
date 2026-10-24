# 新会话默认自动审查 · Default Auto Review

DeepSeek Harness 插件：让新建普通会话默认使用内置的 **自动审查（Auto）**，并让原“新建会话”按钮和快捷键真正创建新会话，不再复用旧空白。

> **⚠️ 这是一个 vibe coding 产物，主要借助 AI 编写和迭代，未经全面安全审计。使用自担风险。**
>
> 本插件涉及权限模式和会话创建行为。请自行检查代码，先在非重要工作区测试并备份重要数据；不要将它当作安全边界，也不要依赖它保护敏感数据、生产环境或主机。软件按现状提供，不保证正确性、安全性或兼容性，详见 [MIT License](./LICENSE)。
>
> **This is a vibe-coded project, developed largely with AI assistance. It has not undergone a comprehensive security audit. Use at your own risk.**

## 兼容范围

- 仅声明支持 **DeepSeek Harness 0.2.1-rc.3**，实际验证环境为 Windows 桌面版。
- 必须启用官方 **Auto Authorization Review / 自动授权审查** 功能，包名为 `@deepseek-ai/dsh-experimental-auto-review`。
- 不保证其他 DSH 版本或操作系统可用。升级 DSH 后，请先重新检查和测试，不要直接放宽版本限制。
- 后端插件配合轻量客户端模块运行，零第三方运行依赖，不修改 DSH 安装包。

## 为什么需要这个插件

该版本原生的新会话默认权限不提供 Auto，而且界面的“新建会话”会优先复用工作区里已有的空白会话。只在后端初始化时切换权限，不能覆盖这个 UI 使用路径。

本插件同时处理两件事：

1. 真正新建的普通会话，在 Agent 开始工作前调用官方 `permissionPresets.set(session, 'auto')`。
2. 明确点击“新建会话”或使用对应快捷键时，不传入旧空白会话的 `sessionId`，而是请求新身份。

**不会为了实现默认 Auto 而改掉已有空白会话的权限。**

## 行为说明

| 场景 | 行为 |
| --- | --- |
| 原“新建会话”按钮或快捷键 | 真正创建新会话，默认 Auto |
| 直接通过 API 创建全新普通会话 | 初始化后选择 Auto |
| 打开、恢复已有会话，包括旧空白会话 | 保留原权限 |
| 分叉会话或子 Agent | 保留继承与委派规则 |
| 初始化调用方已显式设置权限 | 不覆盖 |
| 创建后手动切换权限 | 保留选择，不在之后的回合改回 |
| 官方 Auto 尚未就绪 | 保留官方默认，警告一次，不追补已创建会话 |
| 官方切换接口拒绝或抛错 | 让创建报错，不绕过授权检查或静默放宽权限 |
| 停用本插件 | 移除新建行为适配，后续会话恢复原逻辑；不回写已有会话权限 |

### 权限与安全注意事项

- 官方 Auto 的执行组合是 **全主机文件访问 + 逐工具 LLM 授权审查 + `ask` 审批策略**，不是“工作区沙箱 + 自动点击同意”。
- 模型审查可能误判，也会增加模型调用、费用和等待时间；审查内容遵循 DSH 及当前配置模型提供方的数据处理边界，请自行评估隐私影响。本插件不重新实现、不增强官方审查策略。
- “新建”不再复用旧空白，因此反复新建可能累积更多空白会话；请按需清理或归档。
- 对当前会话手动切回其他权限后，插件不会自动改回；但再点击“新建”会得到另一个默认 Auto 的新会话。
- 本插件不改变原生设置页的“默认权限”列表，该设置页可能仍显示“工作区内修改”。请以新建会话输入框旁的实际权限为准。
- 前端适配依赖当前版本的同步导航调用链及 `connectBlank` 等实现细节，是**受版本约束的兼容 shim**，不是跨版本稳定的官方扩展点。与其他导航插件组合时也可能冲突。
- 停用本插件不会停用官方 Auto。官方集成自身的卸载行为由 DSH 决定；不要用关闭官方集成的方式代替停用本插件。

## 安装

### 从 GitHub 安装

在 DSH 的插件管理页面选择安装，输入：

```text
github:zerofancy/dsh-default-auto-review
```

启用这个 bundle，并确认官方“自动授权审查”功能也已启用，然后**刷新当前 Harness 页面**。

- 插件标识：`@local/dsh-default-auto-review`
- 当前版本：`0.1.1`
- 运行行 ID：`local-default-auto-review-v011`

`@local` 是保留的包标识，不代表 GitHub 仓库是私有的。本项目通过 GitHub 分发；未发布到 npm。

### 从本地源码安装

```sh
git clone https://github.com/zerofancy/dsh-default-auto-review.git
cd dsh-default-auto-review
node scripts/build-client.mjs
```

在插件管理页面安装克隆目录的**绝对路径**，或由熟悉 profile 配置的管理员添加本地链接依赖，并在 `dsh.profile.bundles` 中启用 `@local/dsh-default-auto-review`。保留其他 profile 配置，不要覆盖整个文件。

本地链接安装后，请勿移动或删除源码目录。

仓库包含构建好的 [客户端产物](./client.js)。修改 [客户端源码](./client-core.js) 后运行 `node scripts/build-client.mjs`，重新加载插件并刷新页面；不需要启动新的 Web 服务。不要假定本地文件修改会自动热更新。

## 停用与卸载

在插件管理中停用这个 bundle，或停用 `local-default-auto-review-v011` 行。需要彻底移除时，再卸载该 bundle。

也可在 profile patch 中仅添加以下覆盖：

```yaml
- id: local-default-auto-review-v011
  disabled: true
```

停用后，客户端包装方法会恢复；已有会话的权限不会被本插件修改，也**不会自动降低已有 Auto 会话的权限**。如需限制已有会话，请手动切回工作区权限或其他受限模式。不要关闭官方 Auto 来代替停用本插件。

## 测试

推荐使用 Node.js 24。

### 可独立运行的测试

```sh
npm run build
npm test
```

当前有 **28 项后端逻辑与边界测试**。CI 会检查客户端构建产物是否与源码一致，并运行这些测试。

### 使用实际 DSH 运行库的集成测试

另外有 **13 项集成测试**：7 项使用真实 Session、Agent、PermissionPreset 与官方 Auto 服务；6 项使用安装包中的原始导航方法和真实 Cordis 代理。

集成测试不附带 DSH 运行库，也不连接正在运行的会话或发送模型请求。需要自行安装兼容版本。Windows 桌面版示例：

```powershell
# 若安装目录不同，请相应调整。不要指向 profile 或工作区目录。
$install = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness'
$env:ELECTRON_RUN_AS_NODE = '1'
$env:DSH_TEST_RUNTIME_ROOT = Join-Path $install 'resources\app.asar\dsh'
& (Join-Path $install 'DeepSeek Harness.exe') --test --test-isolation=none test-integration/*.test.js
```

当前验证记录：共 **41 项测试通过**，并在实际界面中确认刷新后通过原新建按钮得到“自动审查”。这些结果只说明已测试场景，不代表全面安全验证或对其他环境的保证。

## 实现概览

- [后端入口](./index.js)：只记录真正新建、没有继承或显式权限的候选；在官方默认初始化后捕获权限投影 baseline；只在 `agent/created` 的 `startup` 路径、状态未变化且 Auto 就绪时切换。
- [身份与权限判断](./core.js)：严格检查当前会话格式、seed、lineage 和默认权限，不扫描或改写现有会话。
- [客户端适配](./client-core.js)：沿用原工作区推导、草稿、导航取消和错误提示，只替换明确“新建”调用中的空白连接动作；并发重复点击仍合并。
- [客户端构建脚本](./scripts/build-client.mjs)：生成无第三方依赖的 DSH 客户端注册模块。

本项目不包含 DSH 源码、用户 profile、认证信息、会话日志、安装备份或本机诊断报告。

## 反馈与授权

请通过 [GitHub Issues](https://github.com/zerofancy/dsh-default-auto-review/issues) 反馈问题，提供 DSH 版本、操作系统和最小复现步骤。**不要提交 API Key、认证 URL、token、完整会话日志或其他敏感信息。**

本项目采用 [MIT License](./LICENSE)，按现状提供，无担保。**再次提醒：这是 vibe coding 产物，使用自担风险。**
