# dsh-canvas-workspace

DeepSeek Harness 的实验性画布工作区插件。用户消息和输入框留在右侧，Agent 回复显示在可平移、缩放的画布上。

## 功能

- 使用 DSH 原生输入框发送、停止回复，以及粘贴或添加图片和文件。
- 拖动回复顶部的手柄可单独摆放回复；新回复从上一条回复的实际位置下方开始。
- 右侧消息与回复双向高亮，点击用户消息可定位对应回复；文字可选择、复制，图片可预览。
- Markdown 与合法的交互式界面内容可以在同一回复中显示；有思考内容时可在生成中查看，并在完成后展开。

交互式界面采用 [open-intelligent-ui](https://github.com/MMMarcinho/open-intelligent-ui) 的受限协议。本插件负责画布中的解析和呈现；引导 Agent 主动生成这类内容的提示插件需单独配置。任意 HTML 或 JavaScript 不会作为交互界面执行。

## 安装与使用

需要本机已安装 DSH，并使用满足 `package.json` 要求的 Node.js。仓库包含已构建的插件；从源码更新时运行：

```bash
git clone https://github.com/MMMarcinho/dsh-canvas-workspace.git
cd dsh-canvas-workspace
npm ci
npm run build
dsh plugin --profile web add link:.
dsh web
```

在 DSH Web 侧栏选择 **Canvas · 画布**。桌面版使用独立的插件 profile，需通过桌面版自己的插件管理入口链接本目录；上面的 Web 命令不会启用桌面版。

本项目尚属实验性，DSH 后续版本可能需要适配。许可与第三方代码归属见 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
