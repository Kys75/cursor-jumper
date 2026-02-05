/*
* Cursor Jumper
* Logic: Event-Driven Recording + UI Prompt for Restoring
* Based on obsidian-remember-cursor-position by dy-sh.
* Modified by Kys75.
* License: MIT
*/

const obsidian = require('obsidian');

const SAFE_DB_FLUSH_INTERVAL = 5000;

// 内置 CSS 样式
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
    dbFileName: '.obsidian/plugins/cursor-jumper/cursor-positions.json',
    saveTimer: SAFE_DB_FLUSH_INTERVAL,
    deleteAfterDays: 90,
    promptDuration: 10000,
};

class CursorJumper extends obsidian.Plugin {
    async onload() {
        await this.loadSettings();
        this.injectStyles();

        this.db = {};
        this.lastSavedDb = {};
        this.activeToastEl = null;
        this.activeTimer = null;

        try {
            this.db = await this.readDb();
            this.cleanupOldEntries();
            this.lastSavedDb = JSON.parse(JSON.stringify(this.db));
        } catch (e) {
            console.error("Cursor Jumper: Error reading database", e);
            this.db = {};
            this.lastSavedDb = {};
        }

        this.debouncedCheckAndSave = obsidian.debounce(() => {
            this.checkEphemeralStateChanged();
        }, 300, true);

        this.addSettingTab(new SettingTab(this.app, this));

        this.registerEvent(
            this.app.workspace.on('file-open', (file) => {
                this.clearPrompt();
                if (file) {
                    this.checkAndShowPrompt(file);
                    this.registerScrollListener();
                }
            })
        );

        this.registerEvent(
            this.app.workspace.on('editor-change', () => this.debouncedCheckAndSave())
        );

        this.registerEvent(this.app.workspace.on('quit', () => { this.writeDb(this.db); }));
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.renameFile(file, oldPath)));
        this.registerEvent(this.app.vault.on('delete', (file) => this.deleteFile(file)));
        
        this.registerInterval(window.setInterval(() => this.writeDb(this.db), this.settings.saveTimer));
    }

    onunload() {
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

    clearPrompt() {
        if (this.activeTimer) {
            clearTimeout(this.activeTimer);
            this.activeTimer = null;
        }
        if (this.activeToastEl) {
            this.activeToastEl.remove();
            this.activeToastEl = null;
        }
    }

    checkAndShowPrompt(file) {
        const fileName = file.path;
        const st = this.db[fileName];
        if (!st) return;

        const activeLeaf = this.app.workspace.getMostRecentLeaf();
        if (activeLeaf) {
            const viewState = activeLeaf.getViewState();
            if (viewState.ephemeralState && (viewState.ephemeralState.scroll || viewState.ephemeralState.line)) {
                return;
            }
        }
        this.createPromptUI(file, st);
    }

    createPromptUI(file, st) {
        const toast = document.body.createEl('div', { cls: 'rcp-prompt-toast' });
        const lineInfo = st.cursor ? `Line ${st.cursor.from.line + 1}` : 'Last position';
        
        toast.createEl('span', { text: `Jump to ${lineInfo}?`, cls: 'rcp-text-info' });

        const btnJump = toast.createEl('button', { text: 'Jump', cls: 'rcp-btn-jump' });
        btnJump.onclick = () => {
            this.restoreEphemeralState(file.path, st);
            this.clearPrompt();
        };

        const btnClose = toast.createEl('button', { text: '✕', cls: 'rcp-btn-close' });
        btnClose.onclick = () => {
            this.clearPrompt();
        };

        requestAnimationFrame(() => {
            toast.addClass('show');
        });

        this.activeToastEl = toast;
        this.activeTimer = setTimeout(() => {
            if (this.activeToastEl) {
                this.activeToastEl.removeClass('show');
                setTimeout(() => this.clearPrompt(), 300);
            }
        }, this.settings.promptDuration);
    }

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
            if (!entry.lastSavedTime) { entry.lastSavedTime = now; continue; }
            if (now - entry.lastSavedTime > expiryMs) {
                delete this.db[path];
                deleteCount++;
            }
        }
        if (deleteCount > 0) this.writeDb(this.db);
    }

    renameFile(file, oldPath) {
        if (this.db[oldPath]) {
            this.db[file.path] = this.db[oldPath];
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
        if (view && view.file && view.file.path === fileName) {
            this.setEphemeralState(st);
            const editor = this.getEditor();
            if (editor) editor.focus();
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
                    state.cursor = { from: { ch: from.ch, line: from.line }, to: { ch: to.ch, line: to.line } };
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
             if (currentScroll !== state.scroll) view.setEphemeralState(state);
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
        containerEl.createEl('h2', { text: 'Cursor Jumper Settings' });

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
            .setDesc('How long the popup stays visible.')
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

module.exports = CursorJumper;