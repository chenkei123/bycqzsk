// B站页面爬取悬浮窗（仅开发者模式可开启）

class FloatCrawler {
    constructor(uiManager, bilibiliCrawler, coreService) {
        this.uiManager = uiManager;
        this.crawler = bilibiliCrawler;
        this.coreService = coreService;
        this.pendingItems = [];
        this.currentType = 'video';
        this.isPanelOpen = false;
        this.currentPage = 1;
        this.itemsPerPage = 20;
        this.initDOM();
        this.bindEvents();
        this.checkImportHash();
        this.updateVisibility();
    }

    isDeveloper() {
        if (typeof isDeveloperMode === 'function') {
            return isDeveloperMode();
        }
        return localStorage.getItem('developerMode') === 'true';
    }

    isEnabled() {
        if (typeof isFloatCrawlerEnabled === 'function') {
            return isFloatCrawlerEnabled();
        }
        return this.isDeveloper() && localStorage.getItem('floatCrawlerEnabled') === 'true';
    }

    initDOM() {
        this.root = document.getElementById('float-crawler-root');
        this.fab = document.getElementById('float-crawler-fab');
        this.panel = document.getElementById('float-crawler-panel');
        this.urlInput = document.getElementById('float-crawler-url');
        this.previewList = document.getElementById('float-crawler-preview-list');
        this.previewSection = document.getElementById('float-crawler-preview');
        this.statusEl = document.getElementById('float-crawler-status');
        this.globalCategory = document.getElementById('float-crawler-global-category');
        this.stepMenu = document.getElementById('float-crawler-step-menu');
    }

    bindEvents() {
        this.fab?.addEventListener('click', () => this.togglePanel());

        document.getElementById('float-crawler-close')?.addEventListener('click', () => this.closePanel());
        document.getElementById('float-crawler-paste-url')?.addEventListener('click', () => this.pasteUrlFromClipboard());
        document.getElementById('float-crawler-use-current')?.addEventListener('click', () => this.useCurrentPageHint());

        document.getElementById('float-crawler-crawl-video')?.addEventListener('click', () => {
            this.currentType = 'video';
            this.startCrawl('video');
        });

        document.getElementById('float-crawler-crawl-article')?.addEventListener('click', () => {
            this.currentType = 'article';
            this.startCrawl('article');
        });

        document.getElementById('float-crawler-select-all')?.addEventListener('click', () => this.setAllSelected(true));
        document.getElementById('float-crawler-select-none')?.addEventListener('click', () => this.setAllSelected(false));
        document.getElementById('float-crawler-back')?.addEventListener('click', () => this.showStepMenu());
        document.getElementById('float-crawler-confirm')?.addEventListener('click', () => this.confirmImport());

        this.globalCategory?.addEventListener('change', (e) => {
            const categoryId = e.target.value;
            this.pendingItems.forEach(item => {
                item.categoryId = categoryId;
            });
            this.renderPreview();
        });

        document.getElementById('float-crawler-toggle-setting')?.addEventListener('change', (e) => {
            if (e.target.checked) {
                localStorage.setItem('floatCrawlerEnabled', 'true');
            } else {
                localStorage.setItem('floatCrawlerEnabled', 'false');
            }
            this.updateVisibility();
        });
    }

    updateVisibility() {
        const dev = this.isDeveloper();
        const enabled = this.isEnabled();

        if (this.root) {
            this.root.classList.toggle('hidden', !dev);
        }

        if (this.fab) {
            this.fab.style.display = enabled ? 'flex' : 'none';
        }

        const settingRow = document.getElementById('float-crawler-setting-row');
        const toggle = document.getElementById('float-crawler-toggle-setting');
        if (settingRow) {
            settingRow.style.display = dev ? 'flex' : 'none';
        }
        if (toggle) {
            toggle.checked = localStorage.getItem('floatCrawlerEnabled') === 'true';
        }

        if (!enabled) {
            this.closePanel();
        }
    }

    togglePanel() {
        if (!this.isEnabled()) {
            this.uiManager.showError('请先在开发者设置中开启爬取悬浮窗，或执行 KBDev.enableFloat()');
            return;
        }

        this.isPanelOpen = !this.isPanelOpen;
        this.panel?.classList.toggle('hidden', !this.isPanelOpen);
        this.fab?.classList.toggle('active', this.isPanelOpen);

        if (this.isPanelOpen) {
            this.showStepMenu();
            this.populateGlobalCategoryOptions();
            this.prefillUrl();
        }
    }

    closePanel() {
        this.isPanelOpen = false;
        this.panel?.classList.add('hidden');
        this.fab?.classList.remove('active');
    }

    showStepMenu() {
        this.stepMenu?.classList.remove('hidden');
        this.previewSection?.classList.add('hidden');
        this.setStatus('选择要爬取的内容类型。请先在上方填写 B 站页面链接（或从 B 站页面复制链接后粘贴）。');
    }

    showPreview() {
        this.stepMenu?.classList.add('hidden');
        this.previewSection?.classList.remove('hidden');
        // 重置分页到第一页
        this.currentPage = 1;
    }

    setStatus(text) {
        if (this.statusEl) {
            this.statusEl.textContent = text;
        }
    }

    prefillUrl() {
        if (!this.urlInput || this.urlInput.value.trim()) {
            return;
        }

        const savedVideo = localStorage.getItem('videoApiUrl');
        const savedArticle = localStorage.getItem('articleApiUrl');
        this.urlInput.value = savedVideo || savedArticle || '';
    }

    async pasteUrlFromClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            if (text && this.isBilibiliUrl(text.trim())) {
                this.urlInput.value = text.trim();
                this.setStatus('已从剪贴板粘贴 B 站链接');
            } else {
                this.uiManager.showError('剪贴板中没有有效的 B 站链接');
            }
        } catch (error) {
            this.uiManager.showError('无法读取剪贴板，请手动粘贴链接');
        }
    }

    useCurrentPageHint() {
        this.setStatus('在 B 站页面请使用「B站激活书签」或安装油猴脚本，悬浮窗会直接出现在 B 站页面上。');
        this.uiManager.showSuccess('请查看开发者工具中的 B 站悬浮窗安装说明');
    }

    isBilibiliUrl(url) {
        try {
            const parsed = new URL(url);
            return parsed.hostname.includes('bilibili.com') || parsed.hostname === 'b23.tv';
        } catch (_) {
            return false;
        }
    }

    populateGlobalCategoryOptions() {
        if (!this.globalCategory) {
            return;
        }

        const categories = this.uiManager.categories || [];
        this.globalCategory.innerHTML = '<option value="">不加入分类</option>';
        categories.forEach((cat) => {
            const option = document.createElement('option');
            option.value = cat.id;
            option.textContent = cat.name;
            this.globalCategory.appendChild(option);
        });
    }

    async startCrawl(type) {
        const pageUrl = this.urlInput?.value.trim();
        if (!pageUrl) {
            this.uiManager.showError('请先填写 B 站页面链接');
            return;
        }

        if (!this.isBilibiliUrl(pageUrl)) {
            this.uiManager.showError('请输入有效的 B 站页面链接');
            return;
        }

        this.setStatus(type === 'video' ? '正在爬取视频...' : '正在爬取专栏...');
        this.uiManager.showLoading();

        try {
            const items = await this.crawler.crawlFromPageUrl(pageUrl, type);
            if (items && items.length > 0) {
                this.pendingItems = items;
                this.currentType = type;
                this.populateGlobalCategoryOptions();
                this.renderPreview();
                this.showPreview();
                this.setStatus(`共爬取 ${items.length} 条${type === 'video' ? '视频' : '专栏'}，可编辑名称并选择分类后导入`);
                return;
            }

            // API 方式未能获取内容，对于视频则打开 B 站页面自动爬取
            if (type === 'video') {
                this.openBilibiliPageForAutoCrawl(pageUrl, 'video');
                return;
            }

            this.uiManager.showError('未能从该页面获取内容，请确认链接正确或 B 站未触发验证码');
            this.setStatus('爬取失败，请更换链接或稍后重试');
        } catch (error) {
            console.error('悬浮窗爬取失败:', error);
            if (type === 'video') {
                this.openBilibiliPageForAutoCrawl(pageUrl, 'video');
                return;
            }
            this.uiManager.showError('爬取失败：' + error.message);
        } finally {
            this.uiManager.hideLoading();
        }
    }

    /**
     * 打开 B 站页面并触发自动爬取（需要油猴脚本/激活书签）
     */
    openBilibiliPageForAutoCrawl(url, type) {
        const autoCrawlUrl = url + (url.includes('#') ? '&' : '#') + 'kbautocrawl=' + type;
        window.open(autoCrawlUrl, '_blank');
        this.uiManager.hideLoading();
        this.showStepMenu();
        this.setStatus('已打开 B 站页面，正在自动爬取' + (type === 'video' ? '视频' : '专栏') + '…\n如未自动爬取，请先安装油猴脚本（开发者工具中复制油猴脚本）');
        this.uiManager.showSuccess('已打开 B 站页面进行自动爬取，请在新标签页中查看');
    }

    setAllSelected(selected) {
        this.pendingItems.forEach(item => {
            item.selected = selected;
        });
        this.renderPreview();
    }

    renderPreview() {
        if (!this.previewList) {
            return;
        }

        const categories = this.uiManager.categories || [];
        this.previewList.innerHTML = '';

        // 计算分页
        const totalItems = this.pendingItems.length;
        const totalPages = Math.ceil(totalItems / this.itemsPerPage);
        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = Math.min(startIndex + this.itemsPerPage, totalItems);
        const pageItems = this.pendingItems.slice(startIndex, endIndex);

        // 渲染当前页的项目
        pageItems.forEach((item, pageIndex) => {
            const globalIndex = startIndex + pageIndex;
            
            // 自动检测分类（如果没有手动设置）
            if (!item.categoryId) {
                item.categoryId = this.getAutoCategoryByTitle(item.title) || '';
            }
            
            const row = document.createElement('div');
            row.className = 'float-crawler-item';

            const categoryOptions = ['<option value="">不加入分类</option>']
                .concat(categories.map(cat => `<option value="${cat.id}" ${item.categoryId === cat.id ? 'selected' : ''}>${this.uiManager.escapeHtml(cat.name)}</option>`))
                .join('');

            // 处理封面 URL，确保格式正确
            let coverUrl = item.cover || '';
            if (coverUrl && coverUrl.startsWith('//')) {
                coverUrl = 'https:' + coverUrl;
            }
            
            // B站图片有防盗链，使用 referrerpolicy 绕过
            const coverHtml = coverUrl
                ? `<img src="${this.uiManager.escapeHtml(coverUrl)}" alt="" class="float-crawler-item-cover" referrerpolicy="no-referrer" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'float-crawler-item-cover no-cover\\'>${item.type === 'video' ? '视频' : '专栏'}</div>';">`
                : `<div class="float-crawler-item-cover no-cover">${item.type === 'video' ? '视频' : '专栏'}</div>`;

            row.innerHTML = `
                <label class="float-crawler-item-check">
                    <input type="checkbox" data-index="${globalIndex}" ${item.selected ? 'checked' : ''}>
                </label>
                ${coverHtml}
                <div class="float-crawler-item-fields">
                    <input type="text" class="float-crawler-item-title" data-index="${globalIndex}" value="${this.uiManager.escapeHtml(item.title)}" placeholder="标题">
                    <a href="${this.uiManager.escapeHtml(item.url)}" target="_blank" rel="noopener" class="float-crawler-item-url">${this.uiManager.escapeHtml(item.url)}</a>
                    <select class="float-crawler-item-category" data-index="${globalIndex}">${categoryOptions}</select>
                </div>
            `;

            row.querySelector('input[type="checkbox"]')?.addEventListener('change', (e) => {
                this.pendingItems[globalIndex].selected = e.target.checked;
            });

            row.querySelector('.float-crawler-item-title')?.addEventListener('input', (e) => {
                this.pendingItems[globalIndex].title = e.target.value;
                // 标题改变时自动更新分类
                const newCategoryId = this.getAutoCategoryByTitle(e.target.value) || '';
                const selectEl = row.querySelector('.float-crawler-item-category');
                if (selectEl && newCategoryId) {
                    selectEl.value = newCategoryId;
                    this.pendingItems[globalIndex].categoryId = newCategoryId;
                }
            });

            row.querySelector('.float-crawler-item-category')?.addEventListener('change', (e) => {
                this.pendingItems[globalIndex].categoryId = e.target.value;
            });

            this.previewList.appendChild(row);
        });

        // 渲染分页控件
        if (totalPages > 1) {
            this.renderPagination(totalPages, totalItems);
        }
    }

    renderPagination(totalPages, totalItems) {
        const paginationDiv = document.createElement('div');
        paginationDiv.className = 'float-crawler-pagination';
        paginationDiv.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:10px;padding:15px;border-top:1px solid #e5e7eb;margin-top:10px;';

        // 上一页按钮
        const prevBtn = document.createElement('button');
        prevBtn.textContent = '上一页';
        prevBtn.className = 'btn btn-secondary btn-sm';
        prevBtn.disabled = this.currentPage === 1;
        prevBtn.onclick = () => {
            if (this.currentPage > 1) {
                this.currentPage--;
                this.renderPreview();
                this.previewList.scrollTop = 0;
            }
        };

        // 页码信息
        const pageInfo = document.createElement('span');
        pageInfo.textContent = `第 ${this.currentPage}/${totalPages} 页 (共${totalItems}条)`;
        pageInfo.style.cssText = 'font-size:14px;color:#64748b;';

        // 下一页按钮
        const nextBtn = document.createElement('button');
        nextBtn.textContent = '下一页';
        nextBtn.className = 'btn btn-secondary btn-sm';
        nextBtn.disabled = this.currentPage === totalPages;
        nextBtn.onclick = () => {
            if (this.currentPage < totalPages) {
                this.currentPage++;
                this.renderPreview();
                this.previewList.scrollTop = 0;
            }
        };

        paginationDiv.appendChild(prevBtn);
        paginationDiv.appendChild(pageInfo);
        paginationDiv.appendChild(nextBtn);

        this.previewList.appendChild(paginationDiv);
    }

    async confirmImport() {
        const selectedItems = this.pendingItems.filter(item => item.selected && item.title.trim());

        if (!selectedItems.length) {
            this.uiManager.showError('请至少选择一条有效内容');
            return;
        }

        this.uiManager.showLoading();

        try {
            let imported = 0;

            for (const item of selectedItems) {
                // 跳过已存在的链接
                var exists = await this.coreService.isUrlExists(item.url);
                if (exists) {
                    continue;
                }

                const saved = await this.coreService.addVideo({
                    type: item.type,
                    title: item.title.trim(),
                    url: item.url,
                    cover: item.cover || '',
                    desc: item.desc || item.title.trim(),
                    tags: []
                });

                // 自动根据标题分类
                const autoCategoryId = this.getAutoCategoryByTitle(item.title);
                const finalCategoryId = item.categoryId || autoCategoryId;
                
                if (finalCategoryId) {
                    this.uiManager.addVideoToCategory(finalCategoryId, saved.id);
                }

                imported++;
            }

            this.uiManager.renderCategories();
            await this.uiManager.renderCurrentView();
            this.uiManager.showSuccess(`成功导入 ${imported} 条内容`);
            this.pendingItems = [];
            this.closePanel();
        } catch (error) {
            console.error('导入失败:', error);
            this.uiManager.showError('导入失败，请重试');
        } finally {
            this.uiManager.hideLoading();
        }
    }

    getAutoCategoryByTitle(title) {
        if (!title) return null;
        
        const lowerTitle = title.toLowerCase();
        
        // 按优先级顺序检测（更具体的匹配优先）
        if (lowerTitle.includes('硬核战双（文字版）')) {
            return 'cat_fixed_hardcore_text';
        }
        if (lowerTitle.includes('硬核战双')) {
            return 'cat_fixed_hardcore';
        }
        if (lowerTitle.includes('潮声回响')) {
            return 'cat_fixed_chaosheng';
        }
        
        return null;
    }

    checkImportHash() {
        const hash = location.hash || '';
        const match = hash.match(/[#&]kbimport=([^&]+)/);
        if (!match) {
            return;
        }

        try {
            const decoded = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(match[1])))));
            const type = decoded.type || 'video';
            const items = this.crawler.normalizeImportedItems(decoded.items || decoded, type);

            if (items.length) {
                // 存储到 sessionStorage，等待 DOM 准备好后再加载
                sessionStorage.setItem('pendingKbImport', JSON.stringify({ type, items }));
                console.log('[FloatCrawler] 导入数据已存储，等待加载:', items.length, '条');
            }
        } catch (error) {
            console.error('解析导入数据失败:', error);
        }

        history.replaceState(null, '', location.pathname + location.search);
    }

    loadPendingImport() {
        const raw = sessionStorage.getItem('pendingKbImport');
        if (!raw) {
            return;
        }

        try {
            const { type, items } = JSON.parse(raw);
            sessionStorage.removeItem('pendingKbImport');

            if (!items || !items.length) {
                return;
            }

            this.pendingItems = items;
            this.currentType = type || 'video';
            this.isPanelOpen = true;

            // 延迟执行，确保 DOM 已准备好
            setTimeout(() => {
                // 重新初始化 DOM 引用（确保获取到最新元素）
                this.initDOM();
                
                if (this.root) {
                    this.root.classList.remove('hidden');
                }
                if (this.fab) {
                    this.fab.style.display = 'flex';
                }
                if (this.panel) {
                    this.panel.classList.remove('hidden');
                }
                if (this.fab) {
                    this.fab.classList.add('active');
                }
                
                this.populateGlobalCategoryOptions();
                this.renderPreview();
                this.showPreview();
                this.setStatus(`从 B 站页面导入了 ${items.length} 条待确认内容，请选择分类后点击「确定导入」`);
                console.log('[FloatCrawler] 导入内容已显示:', items.length, '条');
            }, 200);
        } catch (error) {
            console.error('加载待导入内容失败:', error);
        }
    }

    static generateBookmarklet(kbUrl, injectCode) {
        const target = (kbUrl || 'index.html').replace(/'/g, "\\'");
        localStorage.setItem('kbImportTarget', kbUrl || 'index.html');

        if (injectCode) {
            const encoded = injectCode
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "\\'")
                .replace(/\r?\n/g, '\\n');
            return `javascript:(function(){try{localStorage.setItem('kbImportTarget','${target}');localStorage.setItem('kbFloatEnabled','true');if(window.__KBBiliFloat){window.__KBBiliFloat.enable('${target}');return;}eval('${encoded}');if(window.__KBBiliFloat){window.__KBBiliFloat.enable('${target}');}}catch(e){alert('激活失败:'+e.message);}})();`;
        }

        const base = target.replace(/\/[^/]*$/, '');
        if (/^https?:/i.test(target)) {
            const injectUrl = base + '/bilibili-inject.js';
            return `javascript:(function(){try{var k='${target}';localStorage.setItem('kbImportTarget',k);localStorage.setItem('kbFloatEnabled','true');if(window.__KBBiliFloat){window.__KBBiliFloat.enable(k);return;}var s=document.createElement('script');s.src='${injectUrl}';s.onload=function(){window.__KBBiliFloat.enable(k);};s.onerror=function(){alert('无法加载爬取脚本，请使用知识库中的「复制油猴脚本」');};document.documentElement.appendChild(s);}catch(e){alert('激活失败:'+e.message);}})();`;
        }

        return `javascript:(function(){localStorage.setItem('kbImportTarget','${target}');localStorage.setItem('kbFloatEnabled','true');alert('请返回知识库，点击「复制油猴脚本」安装到 Tampermonkey，然后刷新 B 站页面。');})();`;
    }

    static generateUserscript(kbUrl, injectCode) {
        const target = kbUrl || 'index.html';
        return `// ==UserScript==
// @name         知识库 B站爬取悬浮窗
// @namespace    kb-float-crawler
// @version      1.0.1
// @description  在哔哩哔哩页面显示知识库爬取悬浮窗
// @match        *://*.bilibili.com/*
// @match        *://bilibili.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    const KB_URL = '${target.replace(/'/g, "\\'")}';
    localStorage.setItem('kbImportTarget', KB_URL);
    localStorage.setItem('kbFloatEnabled', 'true');
    ${injectCode}
    if (window.__KBBiliFloat) {
        window.__KBBiliFloat.enable(KB_URL);
    }
})();
`;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FloatCrawler;
}
