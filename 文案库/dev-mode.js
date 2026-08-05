// 开发者模式管理（仅通过控制台命令切换）

(function () {
    function isDeveloperMode() {
        return localStorage.getItem('developerMode') === 'true';
    }

    function isFloatCrawlerEnabled() {
        return isDeveloperMode() && localStorage.getItem('floatCrawlerEnabled') === 'true';
    }

    function reloadWithMode() {
        if (typeof uiManager !== 'undefined' && uiManager.checkDeveloperMode) {
            uiManager.checkDeveloperMode();
        }
        if (window.__floatCrawler && window.__floatCrawler.updateVisibility) {
            window.__floatCrawler.updateVisibility();
        }
    }

    window.KBDev = {
        enable() {
            localStorage.setItem('developerMode', 'true');
            console.log('[知识库] 已切换为开发者模式，正在刷新页面...');
            location.reload();
        },

        disable() {
            localStorage.removeItem('developerMode');
            localStorage.removeItem('floatCrawlerEnabled');
            console.log('[知识库] 已切换为游客模式，正在刷新页面...');
            location.reload();
        },

        enableFloat() {
            if (!isDeveloperMode()) {
                console.warn('[知识库] 请先执行 KBDev.enable() 开启开发者模式');
                return;
            }
            localStorage.setItem('floatCrawlerEnabled', 'true');
            console.log('[知识库] 本站爬取悬浮窗已开启');
            console.log('[知识库] 要在 B 站页面显示悬浮窗，请复制「B站激活书签」或「油猴脚本」并在 B 站使用');
            reloadWithMode();
        },

        disableFloat() {
            localStorage.setItem('floatCrawlerEnabled', 'false');
            console.log('[知识库] 爬取悬浮窗已关闭');
            reloadWithMode();
        },

        toggleFloat() {
            if (!isDeveloperMode()) {
                console.warn('[知识库] 请先执行 KBDev.enable() 开启开发者模式');
                return;
            }
            if (isFloatCrawlerEnabled()) {
                this.disableFloat();
            } else {
                this.enableFloat();
            }
        },

        status() {
            console.log({
                mode: isDeveloperMode() ? '开发者' : '游客',
                floatCrawler: isFloatCrawlerEnabled() ? '已开启' : '已关闭',
                commands: {
                    enable: 'KBDev.enable()',
                    disable: 'KBDev.disable()',
                    enableFloat: 'KBDev.enableFloat()',
                    disableFloat: 'KBDev.disableFloat()',
                    toggleFloat: 'KBDev.toggleFloat()'
                }
            });
        }
    };

    window.isDeveloperMode = isDeveloperMode;
    window.isFloatCrawlerEnabled = isFloatCrawlerEnabled;
})();
