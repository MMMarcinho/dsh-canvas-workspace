# dsh-canvas-workspace

让你的 dsh 更加好用。

一个实验性的 DeepSeek Harness 画布插件。右下角使用 DSH 原生输入框；用户消息留在可滚动的右侧栏，Agent 回复显示在可平移、缩放的画布中。回复可以用顶部拖柄单独移动，新回复从上一条回复的实际位置下方开始。

## 功能

- 同一 DSH 会话中的原生发送、停止、图片与文件附件、流式回复和历史恢复。
- Markdown 与受限 IUI 混排；无效片段保留原文，其余内容继续显示。IUI 图片仅解析明确的 URL 或工作区文件路径。
- DSH 返回思考字段时，生成中显示最新内容，完成后可按需展开查看。
- 右侧已发送消息按 DSH 用户消息样式呈现文字、图片和文件；图片支持预览，文字支持选择与复制。Steer 消息保留各自内容，并与同一回复成组关联。
- 双向悬停高亮、点击用户消息定位回复、三条左右高度的消息栏内滚、柔和背景和减少动态效果支持。
- 画布侧边栏复用 DSH 侧边栏的组件样式与图标：新会话、Canvas/插件/自动化任务/更多、工作区搜索、视图切换、新增工作区和分组会话树。它以浮层覆盖在画布上，不占用画布宽度；画布模式开关位于顶部工具栏，退出后画布仍保持全宽。

画布菜单 → 更多 → **按视口自动排布**，会按当前缩放下的可用宽度整理全部自动回复，避开右侧输入区和手动拖动的回复。宽度足够时排列为多列，放不下时向下延伸，不缩小文字、不改变镜头。图片加载、思考展开或流式内容增高后自动向下避让；手动位置保持不变。布局随会话保存，平移、缩放和窗口变化不会触发重新整理；需要适应新视口时再次点击即可。新回复延续前一回复下方并参与避碰。

Canvas 只在显示层处理历史和布局，不修改已有 DSH 会话事件。图片通过宿主授权的资源加载接口读取，不从展示文字推测附件。普通发送由原生输入框负责；测试不发送真实模型请求。

## 开发与检查

要求 Node.js `^22.19.0 || >=24`。当前开发依赖固定为 DSH `0.2.1-rc.3`；声明支持 `0.2.0-rc.2`、`0.2.1-rc.2` 与 `0.2.1-rc.3`，其它版本需单独验证。`0.2.4-experimental.2` 起直接支持 rc.3，安装时不需要版本兼容豁免。

```bash
npm ci
npm run typecheck
npm test
npm run format:check
npm run test:media
npm run test:rail
node tests/viewport-layout.browser.mjs
npm run build
```

`npm run dev` 启动独立 MOCK 演示。浏览器测试使用本地 Vite 页面，不连接用户当前运行中的 DSH；宿主测试脚本另需隔离的官方 DSH 测试环境。`npm run build` 生成宿主插件 `dist/` 与本地演示 `site/`。仓库包含可直接由现有 DSH 插件链接读取的 `dist/`，`site/` 和测试截图、日志不提交。

## DSH 安装与兼容验证

在插件仓库目录执行：

```bash
npm ci
npm run build
dsh plugin --profile desktop add "$PWD"
```

安装后在 DSH 侧边栏打开 **Canvas · 画布**。本地目录通过链接接入，请保留该目录。

rc.3 的隔离宿主检查可复现为：

```bash
npm install --prefix .research/runtime-021rc3 --save-exact @deepseek-ai/dsh@0.2.1-rc.3
DSH_TEST_RUNTIME=.research/runtime-021rc3 npm run test:host:http
```

宿主检查使用独立 `.host-test/` 配置，不继承个人账号和模型凭据，不设置版本豁免，也不发送模型请求。该检查验证官方安装器、启动图和插件资源；实际画布显示还需在 DSH 中打开验证。

2026-11-04 已使用 rc.3 官方依赖通过类型检查、161 项单元/DOM 测试、格式检查和完整构建；另用桌面版自带的 rc.3 CLI，在空白隔离 Web 配置中验证无豁免安装、启动图与构建文件一致，并确认画布模式下侧边栏以浮层呈现、画布保持全宽，搜索、视图切换、更多菜单和退出画布均可用。以上验证均未发送模型请求。

## 源码与边界

- `src/client.tsx`：DSH 公共扩展点、原生输入框和会话资源接入。
- `src/ui/`：画布、消息栏、侧边栏、回复、图片预览和交互。
- `src/adapters/`：DSH 事件投影与离线 MOCK。
- `vendor/open-intelligent-ui/`：按 MIT 许可保留的受限 IUI 源码；本地差异见其 `CANVAS_PROVENANCE.md`。
- `tests/`：单元、DOM 和隔离浏览器回归。

原生完整用户消息行没有独立公开接口，因此右侧消息区参照 DSH 的 MIT 源码结构与主题 token 实现，并复用公开文件图标、剪贴板、Tooltip、资源加载和灯箱。Canvas 尚未接入原生消息分支操作，也没有原生账户头像接口。项目许可见 [LICENSE](LICENSE)，第三方归属与许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
