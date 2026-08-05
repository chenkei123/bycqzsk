// 应用入口文件 - 初始化和启动应用

class LearningPlatformApp {
    constructor() {
        this.isInitialized = false;
        this.bilibiliCrawler = null;
    }

    /**
     * 初始化应用
     */
    async init() {
        try {
            console.log('正在初始化学习平台...');

            // 显示加载状态
            this.showLoading();

            // 初始化所有服务
            console.log('初始化数据库...');
            initVideoDB();
            
            console.log('初始化核心服务...');
            initCoreService();
            
            console.log('初始化UI管理器...');
            initUIManager();

            // 初始化核心服务
            await coreService.initialize();

            // 初始化UI管理器
            await uiManager.initialize();

            // 初始化B站爬虫
            console.log('初始化B站爬虫...');
            this.bilibiliCrawler = new BilibiliCrawler();
            await this.bilibiliCrawler.init(coreService);

            if (uiManager && typeof uiManager.updateApiCrawlStatus === 'function') {
                uiManager.updateApiCrawlStatus();
            }

            this.initFloatCrawler();

            // 添加CSS样式（用于Toast消息）
            this.addToastStyles();

            // 隐藏加载状态
            this.hideLoading();

            this.isInitialized = true;
            console.log('学习平台初始化完成');

            this.exportMethods();

            // 显示欢迎消息
            this.showWelcomeMessage();

        } catch (error) {
            console.error('应用初始化失败:', error);
            this.showError('应用初始化失败，请刷新页面重试');
        }
    }

    initFloatCrawler() {
        if (typeof FloatCrawler === 'undefined') {
            return;
        }

        this.floatCrawler = new FloatCrawler(uiManager, this.bilibiliCrawler, coreService);
        window.__floatCrawler = this.floatCrawler;

        const bookmarkletUrlInput = document.getElementById('kb-bookmarklet-url');
        if (bookmarkletUrlInput && !bookmarkletUrlInput.value) {
            bookmarkletUrlInput.value = location.href.split('#')[0].split('?')[0];
        }

        const loadInjectCode = async () => {
            const response = await fetch('bilibili-inject.js');
            if (!response.ok) {
                throw new Error('无法加载 bilibili-inject.js');
            }
            return response.text();
        };

        const copyText = async (text, successMsg) => {
            try {
                await navigator.clipboard.writeText(text);
                uiManager.showSuccess(successMsg);
            } catch (_) {
                prompt('请手动复制以下内容：', text);
            }
        };

        document.getElementById('copy-bookmarklet-btn')?.addEventListener('click', async () => {
            try {
                const kbUrl = bookmarkletUrlInput?.value.trim() || location.href.split('#')[0];
                const injectCode = await loadInjectCode();
                const encoded = btoa(unescape(encodeURIComponent(injectCode)));
                const code = `javascript:(function(){try{var k='${kbUrl.replace(/'/g, "\\'")}';localStorage.setItem('kbImportTarget',k);localStorage.setItem('kbFloatEnabled','true');if(window.__KBBiliFloat){window.__KBBiliFloat.enable(k);return;}var s=document.createElement('script');s.textContent=decodeURIComponent(escape(atob('${encoded}')));document.documentElement.appendChild(s);window.__KBBiliFloat.enable(k);}catch(e){alert('激活失败:'+e.message);}})();`;
                await copyText(code, 'B站激活书签已复制。在 B 站页面点击该书签即可显示悬浮窗。');
            } catch (error) {
                console.error(error);
                const kbUrl = bookmarkletUrlInput?.value.trim() || location.href.split('#')[0];
                const code = FloatCrawler.generateBookmarklet(kbUrl);
                await copyText(code, '已复制备用书签（需 http 部署知识库才能自动加载脚本）');
            }
        });

        document.getElementById('copy-userscript-btn')?.addEventListener('click', async () => {
            try {
                const kbUrl = bookmarkletUrlInput?.value.trim() || location.href.split('#')[0];
                const injectCode = await loadInjectCode();
                const userscript = FloatCrawler.generateUserscript(kbUrl, injectCode);
                await copyText(userscript, '油猴脚本已复制。请粘贴到 Tampermonkey 新建脚本中并保存，然后刷新 B 站页面。');
            } catch (error) {
                console.error(error);
                uiManager.showError('复制油猴脚本失败，请确认 bilibili-inject.js 存在');
            }
        });

        this.floatCrawler.updateVisibility();
        this.floatCrawler.loadPendingImport();
    }

    /**
     * 显示加载状态
     */
    showLoading() {
        const loadingEl = document.getElementById('loading-indicator');
        if (loadingEl) {
            loadingEl.classList.remove('hidden');
        }
    }

    /**
     * 隐藏加载状态
     */
    hideLoading() {
        const loadingEl = document.getElementById('loading-indicator');
        if (loadingEl) {
            loadingEl.classList.add('hidden');
        }
    }

    /**
     * 显示欢迎消息
     */
    showWelcomeMessage() {
        // 检查是否是第一次访问
        const hasVisited = localStorage.getItem('hasVisited');
        
        if (!hasVisited) {
            setTimeout(() => {
                uiManager.showSuccess('欢迎使用AI助手个人知识库！开始添加你的第一个视频吧。');
                localStorage.setItem('hasVisited', 'true');
            }, 1000);
        }
    }

    /**
     * 添加Toast样式
     */
    addToastStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .toast {
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 12px 20px;
                border-radius: 8px;
                color: white;
                font-weight: 500;
                z-index: 10000;
                transform: translateX(100%);
                opacity: 0;
                transition: all 0.3s ease;
                max-width: 300px;
                word-wrap: break-word;
            }

            .toast.show {
                transform: translateX(0);
                opacity: 1;
            }

            .toast-success {
                background-color: #10b981;
            }

            .toast-error {
                background-color: #ef4444;
            }

            .toast-info {
                background-color: #3b82f6;
            }

            .empty-state {
                text-align: center;
                padding: 60px 20px;
                color: #64748b;
            }

            .empty-icon {
                font-size: 48px;
                margin-bottom: 16px;
            }

            .empty-state h3 {
                margin-bottom: 8px;
                color: #374151;
            }

            .no-cover {
                background-color: #e5e7eb;
                display: flex;
                align-items: center;
                justify-content: center;
                color: #6b7280;
                font-size: 14px;
            }

            @media (max-width: 768px) {
                .toast {
                    left: 20px;
                    right: 20px;
                    transform: translateY(-100%);
                }

                .toast.show {
                    transform: translateY(0);
                }
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * 显示错误消息
     */
    showError(message) {
        const errorEl = document.createElement('div');
        errorEl.className = 'error-message';
        errorEl.innerHTML = `
            <div style="padding: 20px; background: #fee2e2; border: 1px solid #fecaca; border-radius: 8px; margin: 20px;">
                <h3 style="color: #dc2626; margin: 0 0 10px 0;">初始化失败</h3>
                <p style="color: #7f1d1d; margin: 0 0 15px 0;">${message}</p>
                <button onclick="window.location.reload()" style="padding: 8px 16px; background: #dc2626; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    刷新页面
                </button>
            </div>
        `;
        
        document.body.innerHTML = '';
        document.body.appendChild(errorEl);
    }

    /**
     * 导出应用方法供全局使用
     */
    exportMethods() {
        const app = this;
        window.LearningPlatform = {
            version: '2026.1.0',
            core: coreService,
            ui: uiManager,
            db: videoDB,
            get bilibiliCrawler() {
                return app.bilibiliCrawler;
            }
        };
        window.__learningPlatformApp = app;
    }

    /**
     * 性能监控
     */
    setupPerformanceMonitoring() {
        if (!coreService || typeof coreService.performSearch !== 'function') {
            return;
        }

        const originalPerformSearch = coreService.performSearch;
        coreService.performSearch = async function(...args) {
            const startTime = performance.now();
            const result = await originalPerformSearch.apply(this, args);
            const endTime = performance.now();

            console.log(`搜索耗时: ${(endTime - startTime).toFixed(2)}ms`);
            return result;
        };

        if (!uiManager || typeof uiManager.renderContent !== 'function') {
            return;
        }

        const originalRenderContent = uiManager.renderContent;
        uiManager.renderContent = function(...args) {
            const startTime = performance.now();
            originalRenderContent.apply(this, args);
            const endTime = performance.now();

            console.log(`渲染耗时: ${(endTime - startTime).toFixed(2)}ms`);
        };
    }

    /**
     * 错误处理
     */
    setupErrorHandling() {
        window.addEventListener('error', (event) => {
            console.error('全局错误:', event.error);
        });

        window.addEventListener('unhandledrejection', (event) => {
            console.error('未处理的Promise拒绝:', event.reason);
        });
    }
}

// 应用启动
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // 等待所有脚本加载完成
        if (typeof FlexSearch === 'undefined') {
            console.error('FlexSearch库加载失败');
            return;
        }

        // 创建并启动应用
        const app = new LearningPlatformApp();
        window.__learningPlatformApp = app;

        app.setupErrorHandling();
        app.exportMethods();

        await app.init();
        app.setupPerformanceMonitoring();

    } catch (error) {
        console.error('应用启动失败:', error);
        
        // 显示错误界面
        const errorEl = document.createElement('div');
        errorEl.innerHTML = `
            <div style="padding: 40px; text-align: center; font-family: sans-serif;">
                <h1 style="color: #ef4444;">应用启动失败</h1>
                <p style="color: #64748b; margin-bottom: 20px;">${error.message}</p>
                <button onclick="window.location.reload()" style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer;">
                    重新加载
                </button>
            </div>
        `;
        document.body.innerHTML = '';
        document.body.appendChild(errorEl);
    }
});

// 导出供测试使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LearningPlatformApp };
}