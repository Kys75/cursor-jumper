/*
* Cursor Jumper
* Logic: Event-Driven Recording + UI Prompt for Restoring
* Based on obsidian-remember-cursor-position by dy-sh.
* Modified by Kys75.
* License: MIT
*/

const obsidian = require('obsidian');

const SAFE_DB_FLUSH_INTERVAL = 5000;

// 内置 CSS 样式，确保提示框美观且位置正确
const PLUGIN_STYLES = `
.rcp-prompt-toast {
    position: fixed;
    top: 60px;
    right: 30px;
    z-index: 9999;
    background-color: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    padding: 10px 15px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    opacity: 0;
    transform: translateY(-10px);
    transition: opacity 0.3s ease, transform 0.3s ease;
    max-width: 300px;
}
.rcp-prompt-toast.show {
    opacity: 1;
    transform: translateY(0);
}
.rcp-text-info {
    color: var(--text-normal);
}
.rcp-btn-jump {
    background-color: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    padding: 4px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
}
.rcp-btn-jump:hover {
    background-color: var(--interactive-accent-hover);
}
.rcp-btn-close {
    background-color: transparent;
    color: var(--text-muted);
    border: none;
    cursor: pointer;
    padding: 2px 6px;
    margin-left: 5px;
}
.rcp-btn-close:hover {
    color: var(--text-normal);
}
`;

const DEFAULT_SETTINGS = {
    dbFileName: '.obsidian/plugins/remember-cursor-position/cursor-positions.json',
    saveTimer: SAFE_DB_FLUSH_INTERVAL,
    deleteAfterDays: 90,
    promptDuration: 10000, // 10秒后自动消失
};

class RememberCursorPosition extends obsidian.Plugin {
    async onload() {
        await this.loadSettings();
        
        // 1. 注入样式
        this.injectStyles();

        // 2. 初始化数据
        this.db = {};
        this.lastSavedDb = {};
        
        // 3. UI 状态管理 (State Management)
        this.activeToastEl = null;   // 当前显示的 DOM 元素
        this.activeTimer = null;     // 自动消失计时器

        try {
            this.db = await this.readDb();
            this.cleanupOldEntries();
            this.lastSavedDb = JSON.parse(JSON.stringify(this.db));
        } catch (e) {
            console.error("Remember Cursor Position: Error reading database", e);
            this.db = {};
            this.lastSavedDb = {};
        }

        // 防抖保存
        this.debouncedCheckAndSave = obsidian.debounce(() => {
            this.checkEphemeralStateChanged();
        }, 300, true);

        this.addSettingTab(new SettingTab(this.app, this));

        // --- 事件监听 ---

        // 文件打开：显示提示框
        this.registerEvent(
            this.app.workspace.on('file-open', (file) => {
                // 切换文件时，首先清除上一个文件的提示框（波函数坍缩）
                this.clearPrompt();
                
                if (file) {
                    this.checkAndShowPrompt(file);
                    this.registerScrollListener();
                }
            })
        );

        // 编辑/滚动：记录位置
        this.registerEvent(
            this.app.workspace.on('editor-change', () => this.debouncedCheckAndSave())
        );

        this.registerEvent(this.app.workspace.on('quit', () => { this.writeDb(this.db); }));
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.renameFile(file, oldPath)));
        this.registerEvent(this.app.vault.on('delete', (file) => this.deleteFile(file)));
        
        this.registerInterval(window.setInterval(() => this.writeDb(this.db), this.settings.saveTimer));
    }

    onunload() {
        // 插件卸载时清理 UI
        this.clearPrompt();
        const styleEl = document.getElementById('rcp-styles');
        if (styleEl) styleEl.remove();
    }

    injectStyles() {
        if (!document.getElementById('rcp-styles')) {
            const style = document.createElement('style');
            style.id = 'rcp-styles';
            style.textContent = PLUGIN_STYLES;
            document.head.appendChild(style);
        }
    }

    // --- UI 逻辑：提示框核心 ---

    clearPrompt() {
        // 清除计时器
        if (this.activeTimer) {
            clearTimeout(this.activeTimer);
            this.activeTimer = null;
        }
        // 移除 DOM
        if (this.activeToastEl) {
            this.activeToastEl.remove();
            this.activeToastEl = null;
        }
    }

    checkAndShowPrompt(file) {
        const fileName = file.path;
        const st = this.db[fileName];
        
        // 如果没有历史记录，直接退出
        if (!st) return;

        // 检查是否通过锚点打开 (Anchor Check)
        const activeLeaf = this.app.workspace.getMostRecentLeaf();
        if (activeLeaf) {
            const viewState = activeLeaf.getViewState();
            // 如果原生指令包含定位信息，则不显示提示，避免干扰
            if (viewState.ephemeralState && (viewState.ephemeralState.scroll || viewState.ephemeralState.line)) {
                return;
            }
        }

        // 创建 UI
        this.createPromptUI(file, st);
    }

    createPromptUI(file, st) {
        // 创建容器
        const toast = document.body.createEl('div', { cls: 'rcp-prompt-toast' });
        
        // 文本信息
        const lineInfo = st.cursor ? `第 ${st.cursor.from.line + 1} 行` : '上次位置';
        toast.createEl('span', { text: `回到 ${lineInfo}?`, cls: 'rcp-text-info' });

        // 跳转按钮
        const btnJump = toast.createEl('button', { text: '跳转', cls: 'rcp-btn-jump' });
        btnJump.onclick = () => {
            this.restoreEphemeralState(file.path, st);
            this.clearPrompt(); // 点击后销毁
        };

        // 关闭按钮
        const btnClose = toast.createEl('button', { text: '✕', cls: 'rcp-btn-close' });
        btnClose.onclick = () => {
            this.clearPrompt();
        };

        // 动画：下一帧添加 class 以触发 CSS transition
        requestAnimationFrame(() => {
            toast.addClass('show');
        });

        this.activeToastEl = toast;

        // 设置自动消失定时器 (10秒)
        this.activeTimer = setTimeout(() => {
            if (this.activeToastEl) {
                this.activeToastEl.removeClass('show');
                // 等待 CSS 动画结束后移除 DOM
                setTimeout(() => this.clearPrompt(), 300);
            }
        }, this.settings.promptDuration);
    }

    // --- 核心逻辑：恢复与记录 ---

    registerScrollListener() {
        const activeView = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        if (!activeView) return;

        const scrollContainer = activeView.contentEl.querySelector('.cm-scroller');
        if (scrollContainer) {
            this.registerDomEvent(scrollContainer, 'scroll', () => {
                this.debouncedCheckAndSave();
            });
        }
    }

    cleanupOldEntries() {
        if (this.settings.deleteAfterDays <= 0) return;
        const now = Date.now();
        const expiryMs = this.settings.deleteAfterDays * 24 * 60 * 60 * 1000;
        let deleteCount = 0;

        for (const path in this.db) {
            const entry = this.db[path];
            if (!entry.lastSavedTime) {
                entry.lastSavedTime = now;
                continue;
            }
            if (now - entry.lastSavedTime > expiryMs) {
                delete this.db[path];
                deleteCount++;
            }
        }
        if (deleteCount > 0) {
            this.writeDb(this.db);
        }
    }

    renameFile(file, oldPath) {
        const newName = file.path;
        if (this.db[oldPath]) {
            this.db[newName] = this.db[oldPath];
            delete this.db[oldPath];
        }
    }

    deleteFile(file) {
        delete this.db[file.path];
    }

    checkEphemeralStateChanged() {
        const fileName = this.app.workspace.getActiveFile()?.path;
        if (!fileName) return;

        const st = this.getEphemeralState();
        if (!st.cursor && st.scroll === undefined) return;
        
        this.saveEphemeralState(st);
    }

    async saveEphemeralState(st) {
        const fileName = this.app.workspace.getActiveFile()?.path;
        if (fileName) {
            st.lastSavedTime = Date.now();
            this.db[fileName] = st;
        }
    }

    async restoreEphemeralState(fileName, st) {
        const view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        
        // 双重检查：确保当前视图还是那个文件
        if (view && view.file && view.file.path === fileName) {
            this.setEphemeralState(st);
            // 给用户一个视觉反馈（可选：闪烁一下当前行）
            const editor = this.getEditor();
            if (editor) {
                editor.focus();
            }
        }
    }

    async readDb() {
        let db = {};
        if (await this.app.vault.adapter.exists(this.settings.dbFileName)) {
            const data = await this.app.vault.adapter.read(this.settings.dbFileName);
            db = JSON.parse(data);
        }
        return db;
    }

    async writeDb(db) {
        const newParentFolder = this.settings.dbFileName.substring(0, this.settings.dbFileName.lastIndexOf("/"));
        if (!(await this.app.vault.adapter.exists(newParentFolder))) {
            this.app.vault.adapter.mkdir(newParentFolder);
        }
        if (JSON.stringify(this.db) !== JSON.stringify(this.lastSavedDb)) {
            await this.app.vault.adapter.write(this.settings.dbFileName, JSON.stringify(db));
            this.lastSavedDb = JSON.parse(JSON.stringify(db));
        }
    }

    getEphemeralState() {
        const state = {};
        const view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        
        if (view) {
            const scrollMode = view.currentMode;
            if (scrollMode && scrollMode.getScroll) {
                state.scroll = Number(scrollMode.getScroll().toFixed(4));
            }
            const editor = this.getEditor();
            if (editor) {
                const from = editor.getCursor("anchor");
                const to = editor.getCursor("head");
                if (from && to) {
                    state.cursor = {
                        from: { ch: from.ch, line: from.line },
                        to: { ch: to.ch, line: to.line }
                    };
                }
            }
        }
        return state;
    }

    setEphemeralState(state) {
        const view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        
        if (state.cursor) {
            const editor = this.getEditor();
            if (editor) {
                editor.setSelection(state.cursor.from, state.cursor.to);
                editor.scrollIntoView({from: state.cursor.from, to: state.cursor.to}, true);
            }
        }

        if (view && state.scroll !== undefined) {
             const currentScroll = view.currentMode?.getScroll();
             if (currentScroll !== state.scroll) {
                 view.setEphemeralState(state);
             }
        }
    }

    getEditor() {
        return this.app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.editor;
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class SettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Remember Cursor Position - Settings' });

        new obsidian.Setting(containerEl)
            .setName('Data expiration (days)')
            .setDesc('Remove cursor history for files not opened in X days.')
            .addText(text => text
                .setValue(String(this.plugin.settings.deleteAfterDays))
                .onChange(async (value) => {
                    const days = parseInt(value);
                    if (!isNaN(days)) {
                        this.plugin.settings.deleteAfterDays = days;
                        await this.plugin.saveSettings();
                    }
                }));
        
        new obsidian.Setting(containerEl)
            .setName('Prompt duration (ms)')
            .setDesc('How long the "Jump to position" box stays visible.')
            .addText(text => text
                .setValue(String(this.plugin.settings.promptDuration))
                .onChange(async (value) => {
                    const ms = parseInt(value);
                    if (!isNaN(ms)) {
                        this.plugin.settings.promptDuration = ms;
                        await this.plugin.saveSettings();
                    }
                }));
    }
}

module.exports = RememberCursorPosition;