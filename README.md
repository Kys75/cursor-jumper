# Cursor Jumper

[English](#cursor-jumper-for-obsidian) | [中文说明](#cursor-jumper-obsidian-插件)

---

# Cursor Jumper for Obsidian

A user-friendly plugin that remembers your cursor position and scroll state for each note.

Instead of forcibly scrolling you back, **Cursor Jumper** shows a polite popup in the top-right corner, asking if you want to jump back to where you left off.

## Features

- **Non-intrusive**: Doesn't hijack your scroll when opening notes via links or search.
- **Event-Driven**: Optimized for performance. Only saves when you actually type or scroll.
- **Auto-Cleanup**: Automatically removes data for files you haven't opened in 90 days (configurable).
- **Prompt UI**: A temporary popup appears for 10 seconds (configurable) allowing you to choose to jump or stay.

## Installation

### Via BRAT (Recommended for now)
1. Install **Obsidian42 - BRAT** from the Community Plugins.
2. Add this repository: `Kys75/cursor-jumper`.

### Manual Installation
1. Download the `main.js`, `manifest.json`, and `styles.css` from the Releases page.
2. Create a folder named `cursor-jumper` in your vault's `.obsidian/plugins/` directory.
3. Move the downloaded files into that folder.
4. Reload Obsidian.

## Credits

This plugin is a derivative work based on [obsidian-remember-cursor-position](https://github.com/dy-sh/obsidian-remember-cursor-position) by **dy-sh**.
Major modifications include switching to event-driven architecture and adding the UI prompt mechanism.

## License

MIT License

---

# Cursor Jumper Obsidian 插件

一个用户友好的插件，用于记住您在每个笔记中的光标位置和滚动状态。

**Cursor Jumper** 不会强制滚动您的页面，而是在右上角显示一个优雅的弹窗，询问您是否想要跳转回上次离开的地方。

## 功能特点

- **非侵入式**：通过内部链接或搜索打开笔记时，不会劫持您的滚动操作，完全尊重原生的跳转意图。
- **事件驱动**：性能极致优化。仅在您实际进行输入或滚动时才会保存状态，减少后台资源占用。
- **自动清理**：引入“数据熵减”机制，自动删除超过 90 天（可配置）未打开的文件记录，保持数据库轻量。
- **弹窗交互**：显示一个临时的悬浮提示框（默认持续 10 秒，可配置），让您自主选择是跳转回上次位置还是停留在当前位置。

## 安装方法

### 通过 BRAT 安装（推荐）
1. 在社区插件市场中安装 **Obsidian42 - BRAT**。
2. 在 BRAT 中添加本仓库地址：`Kys75/cursor-jumper`。

### 手动安装
1. 从 GitHub 的 Releases 页面下载 `main.js`, `manifest.json`, 和 `styles.css` 文件。
2. 在您的仓库 `.obsidian/plugins/` 目录下创建一个名为 `cursor-jumper` 的文件夹。
3. 将下载的文件移动到该文件夹中。
4. 重载 Obsidian 即可生效。

## 致谢

本插件是基于 **dy-sh** 的 [obsidian-remember-cursor-position](https://github.com/dy-sh/obsidian-remember-cursor-position) 开发的衍生作品。
主要的修改包括：将核心逻辑重构为事件驱动架构，并添加了 UI 弹窗提示机制。

## 许可证

MIT License