// 展示层 - UI组件和渲染逻辑

class UIManager {
    constructor() {
        this.currentVideos = [];
        this.currentTagStats = {};
        this.isRendering = false;
        this.isInitialized = false;
        this.currentTags = [];
        this.editingVideoId = null;
        this.categories = [];
        this.draggedVideoId = null;
        this.batchMode = false;
        this.selectedVideoIds = new Set();
        // 分页相关
        this.currentPage = 1;
        this.PAGE_SIZE = 20;
        this.allFilteredVideos = [];
    }

    get bilibiliCrawler() {
        return window.LearningPlatform && window.LearningPlatform.bilibiliCrawler
            ? window.LearningPlatform.bilibiliCrawler
            : (window.__crawler || null);
    }

    async initialize() {
        console.log('UIManager 开始初始化...');
        this.initElements();
        this.checkDeveloperMode();
        this.loadApiSettings();
        this.initEventListeners();

        // 恢复类型过滤器状态
        var savedType = localStorage.getItem('kb_typeFilter');
        if (savedType === 'video' || savedType === 'article') {
            this.currentTypeFilter = savedType;
            this.syncToggleState(savedType);
        }

        this.loadCategories();
        await this.renderCurrentView();
        this.isInitialized = true;
        console.log('UIManager 初始化完成');
    }

    syncToggleState(type) {
        if (!this.elements.typeToggle || !this.elements.toggleTrack) return;
        if (type === 'article') {
            this.elements.typeToggle.classList.add('article');
            this.elements.toggleTrack.classList.add('active');
            this.elements.videoLabel?.classList.remove('active');
            this.elements.articleLabel?.classList.add('active');
        } else {
            this.elements.typeToggle.classList.remove('article');
            this.elements.toggleTrack.classList.remove('active');
            this.elements.videoLabel?.classList.add('active');
            this.elements.articleLabel?.classList.remove('active');
        }
    }

    checkDeveloperMode() {
        const isDeveloper = localStorage.getItem('developerMode') === 'true';
        
        this.isDeveloper = isDeveloper;

        if (isDeveloper) {
            document.body.classList.add('developer-mode');
        } else {
            document.body.classList.remove('developer-mode');
        }
        
        // 根据开发者模式显示或隐藏添加视频按钮
        if (this.elements.addVideoBtn) {
            if (isDeveloper) {
                this.elements.addVideoBtn.style.display = 'inline-block';
            } else {
                this.elements.addVideoBtn.style.display = 'none';
            }
        }
        
        // 同样处理创建分类按钮
        if (this.elements.addCategoryBtn) {
            if (isDeveloper) {
                this.elements.addCategoryBtn.style.display = 'inline-block';
            } else {
                this.elements.addCategoryBtn.style.display = 'none';
            }
        }
        
        // 同样处理导出按钮
        if (this.elements.exportBtn) {
            if (isDeveloper) {
                this.elements.exportBtn.style.display = 'inline-block';
            } else {
                this.elements.exportBtn.style.display = 'none';
            }
        }

        // 批量管理按钮
        if (this.elements.batchManageBtn) {
            if (isDeveloper) {
                this.elements.batchManageBtn.style.display = 'inline-block';
            } else {
                this.elements.batchManageBtn.style.display = 'none';
            }
        }

        if (window.__floatCrawler && typeof window.__floatCrawler.updateVisibility === 'function') {
            window.__floatCrawler.updateVisibility();
        }
        
    }

    /**
     * 从本地存储加载接口设置到表单
     */
    loadApiSettings() {
        if (!this.elements.videoApiUrl || !this.elements.articleApiUrl) {
            return;
        }

        const savedVideoUrl = localStorage.getItem('videoApiUrl');
        const savedArticleUrl = localStorage.getItem('articleApiUrl');

        if (savedVideoUrl) {
            this.elements.videoApiUrl.value = savedVideoUrl;
        }

        if (savedArticleUrl) {
            this.elements.articleApiUrl.value = savedArticleUrl;
        }

        this.updateApiCrawlStatus();
    }

    /**
     * 验证B站空间链接
     */
    isValidBilibiliSpaceUrl(url) {
        try {
            const parsed = new URL(url);
            return parsed.hostname === 'space.bilibili.com' && /\/\d+/.test(parsed.pathname);
        } catch (_) {
            return false;
        }
    }

    updateApiCrawlStatus() {
        const statusEl = document.getElementById('api-crawl-status');
        if (!statusEl || !this.isDeveloper) {
            return;
        }

        const lastCrawl = parseInt(localStorage.getItem('bilibiliLastCrawlTime') || '0', 10);
        if (!lastCrawl) {
            statusEl.textContent = '尚未执行自动爬取，保存设置或手动刷新后将立即检测新内容。';
            return;
        }

        const nextCrawl = lastCrawl + 24 * 60 * 60 * 1000;
        const nextTime = new Date(nextCrawl).toLocaleString('zh-CN');
        statusEl.textContent = `上次爬取：${new Date(lastCrawl).toLocaleString('zh-CN')} · 下次自动刷新：${nextTime}`;
    }

    getBilibiliCrawler() {
        if (window.LearningPlatform?.bilibiliCrawler) {
            return window.LearningPlatform.bilibiliCrawler;
        }
        if (window.__learningPlatformApp?.bilibiliCrawler) {
            return window.__learningPlatformApp.bilibiliCrawler;
        }
        return null;
    }

    /**
     * 保存接口设置
     */
    saveApiSettings() {
        if (!this.isDeveloper) {
            return;
        }
        if (!this.elements.videoApiUrl || !this.elements.articleApiUrl) {
            return;
        }

        const videoApiUrl = this.elements.videoApiUrl.value.trim();
        const articleApiUrl = this.elements.articleApiUrl.value.trim();

        // 验证链接格式
        if (!this.isValidUrl(videoApiUrl)) {
            this.showError('视频接口链接格式不正确');
            return;
        }

        if (!this.isValidUrl(articleApiUrl)) {
            this.showError('专栏接口链接格式不正确');
            return;
        }

        if (!this.isValidBilibiliSpaceUrl(videoApiUrl)) {
            this.showError('视频接口必须是B站空间链接（space.bilibili.com）');
            return;
        }

        if (!this.isValidBilibiliSpaceUrl(articleApiUrl)) {
            this.showError('专栏接口必须是B站空间链接（space.bilibili.com）');
            return;
        }

        // 通知bilibiliCrawler更新接口链接
        const crawler = this.getBilibiliCrawler();
        if (crawler) {
            crawler.updateApiUrls(videoApiUrl, articleApiUrl)
                .then((result) => {
                    this.updateApiCrawlStatus();
                    const total = (result.newVideos || 0) + (result.newArticles || 0);
                    if (total > 0) {
                        this.showSuccess(`接口设置已保存，新增 ${result.newVideos} 个视频、${result.newArticles} 篇专栏`);
                    } else {
                        this.showSuccess('接口设置保存成功，暂无新内容');
                    }
                })
                .catch(() => {
                    this.showSuccess('接口设置保存成功');
                });
            return;
        }

        localStorage.setItem('videoApiUrl', videoApiUrl);
        localStorage.setItem('articleApiUrl', articleApiUrl);
        this.showSuccess('接口设置保存成功');
    }

    /**
     * 验证URL格式
     */
    isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    }

    /**
     * 手动刷新爬取
     */
    async refreshApiCrawl() {
        if (!this.isDeveloper) {
            return;
        }

        this.showLoading();

        try {
            // 确保接口设置已保存
            const videoApiUrl = this.elements.videoApiUrl.value.trim();
            const articleApiUrl = this.elements.articleApiUrl.value.trim();

            // 验证链接格式
            if (!this.isValidUrl(videoApiUrl)) {
                this.showError('视频接口链接格式不正确');
                this.hideLoading();
                return;
            }

            if (!this.isValidUrl(articleApiUrl)) {
                this.showError('专栏接口链接格式不正确');
                this.hideLoading();
                return;
            }

            if (!this.isValidBilibiliSpaceUrl(videoApiUrl) || !this.isValidBilibiliSpaceUrl(articleApiUrl)) {
                this.showError('接口链接必须是B站空间链接（space.bilibili.com）');
                this.hideLoading();
                return;
            }

            // 立刻刷新两个空间页并爬取当前页面内容
            const crawler = this.getBilibiliCrawler();
            if (crawler) {
                const result = await crawler.updateApiUrls(videoApiUrl, articleApiUrl, {
                    crawl: true,
                    forcePageRefresh: true
                });
                this.updateApiCrawlStatus();
                const total = (result.newVideos || 0) + (result.newArticles || 0);
                if (total > 0) {
                    this.showSuccess(`刷新完成，新增 ${result.newVideos} 个视频、${result.newArticles} 篇专栏`);
                } else if (result.error) {
                    this.showError(`爬取失败：${result.error}。B站可能触发验证码，请稍后重试。`);
                } else {
                    this.showError('未能获取B站内容，可能被验证码拦截或网络代理不可用，请稍后重试。');
                }
            } else {
                this.showError('B站爬虫正在初始化，请等待页面加载完成后再试');
            }
        } catch (error) {
            console.error('手动刷新爬取失败:', error);
            this.showError('手动刷新爬取失败，请检查控制台错误信息');
        } finally {
            this.hideLoading();
        }
    }

    initElements() {
        this.elements = {
            modeSwitcher: document.querySelector('.mode-switcher'),
            modeButtons: document.querySelectorAll('.mode-btn'),
            
            searchInput: document.getElementById('search-input'),
            searchResultsCount: document.getElementById('search-results-count'),
            tagCloud: document.getElementById('tag-cloud'),
            
            addVideoBtn: document.getElementById('add-video-btn'),
            addCategoryBtn: document.getElementById('add-category-btn'),
            exportBtn: document.getElementById('export-btn'),
            
            categoriesContainer: document.getElementById('categories-container'),
            
            contentContainer: document.getElementById('content-container'),
            
            addVideoModal: document.getElementById('add-video-modal'),
            closeModal: document.getElementById('close-modal'),
            cancelForm: document.getElementById('cancel-form'),
            videoForm: document.getElementById('video-form'),
            
            videoUrl: document.getElementById('video-url'),
            videoTitle: document.getElementById('video-title'),
            videoCover: document.getElementById('video-cover'),
            coverUpload: document.getElementById('cover-upload'),
            pasteArea: document.getElementById('paste-area'),
            videoDesc: document.getElementById('video-desc'),
            videoTags: document.getElementById('video-tags'),
            tagsPreview: document.getElementById('tags-preview'),
            smartFillBtn: document.getElementById('smart-fill-btn'),
            contentType: document.getElementById('content-type'),
            typeToggle: document.getElementById('type-toggle'),
            toggleTrack: document.querySelector('.toggle-track'),
            videoLabel: document.querySelector('.video-label'),
            articleLabel: document.querySelector('.article-label'),
            
            videoApiUrl: document.getElementById('video-api-url'),
            articleApiUrl: document.getElementById('article-api-url'),
            saveApiBtn: document.getElementById('save-api-btn'),
            refreshApiBtn: document.getElementById('refresh-api-btn'),
            
            loadingIndicator: document.getElementById('loading-indicator'),
            
            scrollSentinel: document.getElementById('scroll-sentinel'),
            paginationContainer: document.getElementById('pagination-container'),

            // 批量导入相关元素
            batchImportBtn: document.getElementById('batch-import-btn'),
            autoScanCategoryBtn: document.getElementById('auto-scan-category-btn'),
            batchImportModal: document.getElementById('batch-import-modal'),
            closeBatchModal: document.getElementById('close-batch-modal'),
            cancelBatchModal: document.getElementById('cancel-batch-modal'),
            batchUrlInput: document.getElementById('batch-url-input'),
            batchPasteBtn: document.getElementById('batch-paste-btn'),
            batchClearBtn: document.getElementById('batch-clear-btn'),
            batchUrlCount: document.getElementById('batch-url-count'),
            batchDefaultType: document.getElementById('batch-default-type'),
            batchTags: document.getElementById('batch-tags'),
            batchPreviewArea: document.getElementById('batch-preview-area'),
            batchPreviewCount: document.getElementById('batch-preview-count'),
            batchPreviewList: document.getElementById('batch-preview-list'),
            batchPreviewBtn: document.getElementById('batch-preview-btn'),
            batchStartBtn: document.getElementById('batch-start-btn'),
            batchProgressArea: document.getElementById('batch-progress-area'),
            batchProgressBar: document.getElementById('batch-progress-bar'),
            batchProgressText: document.getElementById('batch-progress-text'),

            // 批量管理相关元素
            batchManageBtn: document.getElementById('batch-manage-btn'),
            batchToolbar: document.getElementById('batch-toolbar'),
            batchSelectedCount: document.getElementById('batch-selected-count'),
            batchSelectAllBtn: document.getElementById('batch-select-all-btn'),
            batchDeselectAllBtn: document.getElementById('batch-deselect-all-btn'),
            batchDeleteBtn: document.getElementById('batch-delete-btn'),
            batchExitBtn: document.getElementById('batch-exit-btn')
        };
    }

    initEventListeners() {
        console.log('初始化事件监听器...');
        
        this.elements.modeButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = e.target.dataset.mode;
                this.switchMode(mode);
            });
        });

        this.elements.searchInput.addEventListener('input', (e) => {
            coreService.debouncedSearch(e.target.value, (videos) => {
                this.currentPage = 1;
                this.renderContent(videos);
            });
        });

        this.elements.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                var query = e.target.value;
                coreService.performSearch(query, (videos) => {
                    this.currentPage = 1;
                    this.renderContent(videos);
                });
            }
        });

        // 监听视频添加事件，自动更新页面
        coreService.addEventListener('videoAdded', async () => {
            await this.renderCurrentView();
        });

        // 监听视频更新事件，自动更新页面
        coreService.addEventListener('videoUpdated', async () => {
            await this.renderCurrentView();
        });

        // 监听视频删除事件，自动更新页面
        coreService.addEventListener('videoDeleted', async () => {
            await this.renderCurrentView();
        });

        this.elements.addVideoBtn.addEventListener('click', () => {
            this.showAddVideoModal();
        });

        // 批量导入按钮
        if (this.elements.batchImportBtn) {
            this.elements.batchImportBtn.addEventListener('click', () => {
                this.showBatchImportModal();
            });
        }

        // 自动扫描分类按钮
        if (this.elements.autoScanCategoryBtn) {
            this.elements.autoScanCategoryBtn.addEventListener('click', () => {
                this.autoScanCategorize();
            });
        }

        // 批量管理按钮
        if (this.elements.batchManageBtn) {
            this.elements.batchManageBtn.addEventListener('click', () => {
                this.toggleBatchMode();
            });
        }
        if (this.elements.batchSelectAllBtn) {
            this.elements.batchSelectAllBtn.addEventListener('click', () => {
                this.selectAllInBatch(true);
            });
        }
        if (this.elements.batchDeselectAllBtn) {
            this.elements.batchDeselectAllBtn.addEventListener('click', () => {
                this.selectAllInBatch(false);
            });
        }
        if (this.elements.batchDeleteBtn) {
            this.elements.batchDeleteBtn.addEventListener('click', () => {
                this.batchDeleteVideos();
            });
        }
        if (this.elements.batchExitBtn) {
            this.elements.batchExitBtn.addEventListener('click', () => {
                this.toggleBatchMode();
            });
        }

        if (this.elements.addCategoryBtn) {
            this.elements.addCategoryBtn.addEventListener('click', () => {
                this.showAddCategoryModal();
            });
        }

        this.elements.exportBtn.addEventListener('click', () => {
            this.exportData();
        });

        // 保存接口设置按钮事件
        if (this.elements.saveApiBtn) {
            this.elements.saveApiBtn.addEventListener('click', () => {
                this.saveApiSettings();
            });
        }

        // 手动刷新爬取按钮事件
        if (this.elements.refreshApiBtn) {
            this.elements.refreshApiBtn.addEventListener('click', () => {
                this.refreshApiCrawl();
            });
        }

        // 视频/文章切换按钮事件
        if (this.elements.toggleTrack && this.elements.typeToggle) {
            this.elements.toggleTrack.addEventListener('click', () => {
                const isArticle = this.elements.typeToggle.classList.contains('article');
                
                if (isArticle) {
                    // 切换到视频
                    this.elements.typeToggle.classList.remove('article');
                    this.elements.toggleTrack.classList.remove('active');
                    this.elements.videoLabel.classList.add('active');
                    this.elements.articleLabel.classList.remove('active');
                    this.filterByType('video');
                } else {
                    // 切换到文章
                    this.elements.typeToggle.classList.add('article');
                    this.elements.toggleTrack.classList.add('active');
                    this.elements.videoLabel.classList.remove('active');
                    this.elements.articleLabel.classList.add('active');
                    this.filterByType('article');
                }
            });
        }

        this.elements.closeModal.addEventListener('click', () => {
            this.hideAddVideoModal();
        });

        this.elements.cancelForm.addEventListener('click', () => {
            this.hideAddVideoModal();
        });

        this.elements.videoForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleFormSubmit();
        });

        this.elements.smartFillBtn.addEventListener('click', () => {
            this.smartFillForm();
        });

        // 输入URL后自动尝试获取标题（失去焦点时触发）
        this.elements.videoUrl.addEventListener('blur', () => {
            var url = this.elements.videoUrl.value.trim();
            if (url && !this.elements.videoTitle.value) {
                this.smartFillForm();
            }
        });

        this.elements.videoTags.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                this.addTagFromInput();
            }
        });

        this.elements.videoTags.addEventListener('blur', () => {
            this.addTagFromInput();
        });

        // 封面上传功能
        if (this.elements.coverUpload) {
            this.elements.coverUpload.addEventListener('change', (e) => {
                this.handleCoverUpload(e);
            });
        }

        // 粘贴图片功能 - 在模态框上监听全局粘贴事件（关键修复）
        if (this.elements.addVideoModal) {
            this.elements.addVideoModal.addEventListener('paste', (e) => {
                // 只处理来自剪贴板的图片粘贴
                const items = e.clipboardData?.items;
                if (!items) return;
                
                let hasImage = false;
                for (let i = 0; i < items.length; i++) {
                    if (items[i].type.startsWith('image/')) {
                        hasImage = true;
                        break;
                    }
                }
                
                if (hasImage) {
                    e.preventDefault(); // 阻止默认行为
                    e.stopPropagation();
                    this.handlePasteImage(e);
                }
            });
        }

        // 粘贴区域点击提示
        if (this.elements.pasteArea) {
            this.elements.pasteArea.setAttribute('contenteditable', 'true'); // 使其可聚焦接收粘贴
            this.elements.pasteArea.addEventListener('focus', () => {
                this.elements.pasteArea.classList.add('paste-active');
            });
            this.elements.pasteArea.addEventListener('blur', () => {
                this.elements.pasteArea.classList.remove('paste-active');
                // 清空可能误输入的文本
                this.elements.pasteArea.textContent = '或直接粘贴图片到此处 (Ctrl+V)';
            });
            // 兼容性：同时保留原有的paste事件监听
            this.elements.pasteArea.addEventListener('paste', (e) => {
                this.handlePasteImage(e);
            });
            // 拖拽支持
            this.elements.pasteArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                this.elements.pasteArea.classList.add('paste-dragover');
            });
            this.elements.pasteArea.addEventListener('dragleave', () => {
                this.elements.pasteArea.classList.remove('paste-dragover');
            });
            this.elements.pasteArea.addEventListener('drop', (e) => {
                e.preventDefault();
                this.elements.pasteArea.classList.remove('paste-dragover');
                this.handleDropImage(e);
            });
        }

        this.initInfiniteScroll();
        this.initBatchImportListeners();
    }

    initInfiniteScroll() {
        // 分页模式：不使用无限滚动
    }

    async switchMode(mode) {
        this.elements.modeButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });

        if (mode === MODE.KNOWLEDGE) {
            this.elements.tagCloud.classList.remove('hidden');
            await this.renderTagCloud();
        } else {
            this.elements.tagCloud.classList.add('hidden');
        }

        await coreService.switchMode(mode);
        await this.renderCurrentView();
    }

    // 当前过滤状态
    currentCategoryFilter = null;
    currentTypeFilter = null; // 'video', 'article', or null

    async renderCurrentView() {
        if (this.isRendering) return;
        
        this.isRendering = true;
        this.currentPage = 1;
        this.showLoading();

        try {
            let videos = [];
            
            if (this.currentCategoryFilter) {
                // 按分类过滤
                videos = await this.filterVideosByCategory(this.currentCategoryFilter);
            } else if (coreService.currentTagFilter) {
                videos = await videoDB.queryVideosByTag(coreService.currentTagFilter);
            } else if (coreService.currentQuery) {
                videos = await this.performSearch(coreService.currentQuery);
            } else {
                // 分页模式：统一获取全部内容，再在前端分页
                videos = await videoDB.getAllVideos();
                // 时间线模式按添加时间倒序排列
                if (coreService.currentMode === MODE.TIMELINE) {
                    videos.sort(function(a, b) { return b.addDate - a.addDate; });
                }
            }

            // 去重：确保同一内容不会因多个标签等原因重复显示
            var seenIds = new Set();
            videos = videos.filter(function(v) {
                if (seenIds.has(v.id)) return false;
                seenIds.add(v.id);
                return true;
            });

            // 应用类型过滤
            if (this.currentTypeFilter) {
                videos = videos.filter(video => video.type === this.currentTypeFilter);
            }

            this.renderContent(videos);
            this.renderCategories(); // 同时渲染分类
        } catch (error) {
            console.error('渲染内容失败:', error);
            this.showError('加载内容失败，请刷新页面重试');
        } finally {
            this.hideLoading();
            this.isRendering = false;
        }
    }

    /**
     * 按分类过滤视频
     */
    async filterVideosByCategory(categoryId) {
        const allVideos = await videoDB.getAllVideos();
        const category = this.categories.find(c => c.id === categoryId);
        if (!category) return [];
        return allVideos.filter(video => category.videoIds.includes(video.id));
    }

    /**
     * 按分类过滤
     */
    async filterByCategory(categoryId) {
        this.currentCategoryFilter = categoryId;
        await this.renderCurrentView();
    }

    /**
     * 清除分类过滤
     */
    async clearCategoryFilter() {
        this.currentCategoryFilter = null;
        // 移除所有分类的选中状态
        this.categories.forEach(c => {
            const el = document.querySelector(`.category-item[data-category-id="${c.id}"]`);
            if (el) {
                el.classList.remove('active');
            }
        });
        await this.renderCurrentView();
    }

    /**
     * 按类型过滤
     */
    async filterByType(type) {
        this.currentTypeFilter = type;
        localStorage.setItem('kb_typeFilter', type);
        await this.renderCurrentView();
    }

    async performSearch(query) {
        return new Promise((resolve) => {
            coreService.performSearch(query, (videos) => {
                resolve(videos);
            });
        });
    }

    renderContent(videos) {
        // 应用类型过滤（确保搜索/事件触发时也符合当前开关状态）
        if (this.currentTypeFilter) {
            videos = videos.filter(v => v.type === this.currentTypeFilter);
        }

        // 去重：防止同一内容重复渲染
        var seenIds = new Set();
        videos = videos.filter(function(v) {
            if (seenIds.has(v.id)) return false;
            seenIds.add(v.id);
            return true;
        });

        // 存储全部筛选后的视频，用于分页
        this.allFilteredVideos = videos;
        this.currentVideos = videos;
        
        this.elements.searchResultsCount.textContent = videos.length;

        this.elements.contentContainer.innerHTML = '';

        if (videos.length === 0) {
            this.renderEmptyState();
            this.renderPagination(0);
            return;
        }

        // 计算分页
        var totalPages = Math.ceil(videos.length / this.PAGE_SIZE);
        if (this.currentPage > totalPages) this.currentPage = 1;
        if (this.currentPage < 1) this.currentPage = 1;

        // 获取当前页的视频
        var startIndex = (this.currentPage - 1) * this.PAGE_SIZE;
        var pageVideos = videos.slice(startIndex, startIndex + this.PAGE_SIZE);

        if (coreService.currentMode === MODE.TIMELINE) {
            this.renderTimelineView(pageVideos);
        } else {
            this.renderKnowledgeView(pageVideos);
        }

        // 渲染分页控件
        this.renderPagination(videos.length);
    }

    renderTimelineView(videos) {
        const container = document.createElement('div');
        container.className = 'timeline-view';

        videos.forEach(video => {
            const card = this.createVideoCard(video, MODE.TIMELINE);
            container.appendChild(card);
        });

        this.elements.contentContainer.appendChild(container);
    }

    renderKnowledgeView(videos) {
        const container = document.createElement('div');
        container.className = 'knowledge-view';

        videos.forEach(video => {
            const card = this.createVideoCard(video, MODE.KNOWLEDGE);
            container.appendChild(card);
        });

        this.elements.contentContainer.appendChild(container);
    }

    /**
     * 渲染分页控件
     */
    renderPagination(totalCount) {
        var container = this.elements.paginationContainer;
        if (!container) return;
        container.innerHTML = '';

        if (totalCount <= this.PAGE_SIZE) return;

        var totalPages = Math.ceil(totalCount / this.PAGE_SIZE);
        var currentPage = this.currentPage;

        // 上一页按钮
        var prevBtn = document.createElement('button');
        prevBtn.className = 'pagination-btn';
        prevBtn.textContent = '上一页';
        prevBtn.disabled = currentPage <= 1;
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) this.goToPage(currentPage - 1);
        });
        container.appendChild(prevBtn);

        // 计算显示的页码范围
        var startPage = Math.max(1, currentPage - 2);
        var endPage = Math.min(totalPages, startPage + 4);
        if (endPage - startPage < 4) startPage = Math.max(1, endPage - 4);

        // 第一页 + 省略号
        if (startPage > 1) {
            container.appendChild(this.createPageBtn(1, currentPage));
            if (startPage > 2) {
                var ellipsis1 = document.createElement('span');
                ellipsis1.className = 'pagination-ellipsis';
                ellipsis1.textContent = '...';
                container.appendChild(ellipsis1);
            }
        }

        // 页码按钮
        for (var i = startPage; i <= endPage; i++) {
            container.appendChild(this.createPageBtn(i, currentPage));
        }

        // 省略号 + 最后一页
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                var ellipsis2 = document.createElement('span');
                ellipsis2.className = 'pagination-ellipsis';
                ellipsis2.textContent = '...';
                container.appendChild(ellipsis2);
            }
            container.appendChild(this.createPageBtn(totalPages, currentPage));
        }

        // 下一页按钮
        var nextBtn = document.createElement('button');
        nextBtn.className = 'pagination-btn';
        nextBtn.textContent = '下一页';
        nextBtn.disabled = currentPage >= totalPages;
        nextBtn.addEventListener('click', () => {
            if (currentPage < totalPages) this.goToPage(currentPage + 1);
        });
        container.appendChild(nextBtn);

        // 页码信息
        var info = document.createElement('span');
        info.className = 'pagination-info';
        info.textContent = currentPage + '/' + totalPages + ' 页 (共' + totalCount + '条)';
        container.appendChild(info);
    }

    /**
     * 创建页码按钮
     */
    createPageBtn(pageNum, currentPage) {
        var btn = document.createElement('button');
        btn.className = 'pagination-btn' + (pageNum === currentPage ? ' active' : '');
        btn.textContent = pageNum;
        btn.addEventListener('click', () => {
            this.goToPage(pageNum);
        });
        return btn;
    }

    /**
     * 跳转到指定页
     */
    goToPage(pageNum) {
        this.currentPage = pageNum;
        var startIndex = (this.currentPage - 1) * this.PAGE_SIZE;
        var pageVideos = this.allFilteredVideos.slice(startIndex, startIndex + this.PAGE_SIZE);

        this.elements.contentContainer.innerHTML = '';

        if (coreService.currentMode === MODE.TIMELINE) {
            this.renderTimelineView(pageVideos);
        } else {
            this.renderKnowledgeView(pageVideos);
        }

        this.renderPagination(this.allFilteredVideos.length);

        // 滚动到页面顶部
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    createVideoCard(content, mode) {
        const card = document.createElement('div');
        card.className = 'video-card ' + mode + ' ' + content.type;
        card.dataset.videoId = content.id;
        card.draggable = !this.batchMode;

        // 批量模式下添加选中状态类
        if (this.batchMode && this.selectedVideoIds.has(content.id)) {
            card.classList.add('batch-selected');
        }

        const date = new Date(content.addDate).toLocaleDateString('zh-CN');
        const contentCategories = this.categories.filter(c => c.videoIds.includes(content.id));
        const categoryNames = contentCategories.map(c => c.name);
        
        // 批量模式下在卡片前添加复选框
        var batchCheckboxHtml = '';
        if (this.batchMode) {
            var checked = this.selectedVideoIds.has(content.id) ? 'checked' : '';
            batchCheckboxHtml = '<label class="batch-card-check"><input type="checkbox" class="batch-card-checkbox" ' + checked + '></label>';
        }
        
        let coverHtml = '';
        if (content.cover) {
            coverHtml = '<div class="video-cover"><img src="' + content.cover + '" alt="' + this.escapeHtml(content.title) + '" loading="lazy"></div>';
        } else {
            coverHtml = '<div class="video-cover no-cover">' + (content.type === 'article' ? '文章' : '无封面') + '</div>';
        }
        
        let tagsHtml = '';
        if (content.tags && content.tags.length > 0) {
            tagsHtml = content.tags.map(tag => '<span class="video-tag">' + this.escapeHtml(tag) + '</span>').join('');
        }
        
        let categoryHtml = '';
        if (categoryNames.length > 0) {
            categoryHtml = '<div class="video-categories">分类: ' + categoryNames.map(n => this.escapeHtml(n)).join(', ') + '</div>';
        }

        // 管理员模式下生成编辑、删除和分类按钮
        var adminButtons = '';
        if (this.isDeveloper) {
            adminButtons = '<button class="btn btn-secondary edit-video">编辑</button>' +
                '<button class="btn btn-secondary delete-video">删除</button>' +
                '<button class="btn btn-secondary card-category-btn" title="添加到分类">分类</button>';
        }

        if (mode === MODE.TIMELINE) {
            card.innerHTML = batchCheckboxHtml + coverHtml +
                '<div class="video-content">' +
                    '<h3 class="video-title">' + this.escapeHtml(content.title) + '</h3>' +
                    '<p class="video-desc">' + this.escapeHtml(content.desc) + '</p>' +
                    '<div class="video-meta">' +
                        '<span class="video-date">' + date + '</span>' +
                        '<div class="video-tags">' + tagsHtml + '</div>' +
                    '</div>' +
                    categoryHtml +
                    '<div class="video-actions">' +
                        '<a href="' + content.url + '" target="_blank" class="btn btn-secondary">' + (content.type === 'article' ? '阅读文章' : '观看视频') + '</a>' +
                        adminButtons +
                    '</div>' +
                '</div>';
        } else {
            card.innerHTML = batchCheckboxHtml + coverHtml +
                '<div class="video-content">' +
                    '<h3 class="video-title">' + this.escapeHtml(content.title) + '</h3>' +
                    '<p class="video-desc">' + this.escapeHtml(content.desc) + '</p>' +
                    '<div class="video-tags">' + tagsHtml + '</div>' +
                    categoryHtml +
                    '<div class="video-actions">' +
                        '<a href="' + content.url + '" target="_blank" class="btn btn-secondary">' + (content.type === 'article' ? '阅读文章' : '观看视频') + '</a>' +
                        adminButtons +
                    '</div>' +
                '</div>';
        }

        card.addEventListener('dragstart', (e) => {
            this.draggedVideoId = content.id;
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        card.addEventListener('dragend', () => {
            this.draggedVideoId = null;
            card.classList.remove('dragging');
        });

        this.attachCardEventListeners(card, content);

        return card;
    }

    attachCardEventListeners(card, content) {
        const editBtn = card.querySelector('.edit-video');
        const deleteBtn = card.querySelector('.delete-video');

        if (editBtn) {
            editBtn.addEventListener('click', () => {
                this.editVideo(content);
            });
        }

        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                this.deleteVideo(content.id);
            });
        }

        // 分类按钮：弹出下拉菜单选择分类
        const categoryBtn = card.querySelector('.card-category-btn');
        if (categoryBtn) {
            categoryBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.showCardCategoryMenu(categoryBtn, content);
            });
        }

        // 批量模式下处理复选框和卡片点击
        const batchCheckbox = card.querySelector('.batch-card-checkbox');
        if (batchCheckbox) {
            batchCheckbox.addEventListener('change', (e) => {
                e.stopPropagation();
                this.toggleVideoSelection(content.id, e.target.checked, card);
            });
            // 阻止点击label/checkbox时触发卡片其他事件
            batchCheckbox.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }

        // 批量模式下点击卡片也可切换选中状态
        if (this.batchMode) {
            card.addEventListener('click', (e) => {
                // 避免点击链接、按钮等元素时触发
                if (e.target.closest('a, button, input, label')) return;
                const isChecked = this.selectedVideoIds.has(content.id);
                this.toggleVideoSelection(content.id, !isChecked, card);
            });
        }
    }

    /**
     * 显示卡片分类选择下拉菜单
     * 交互：点击按钮 → 显示分类列表（单选）→ 点击「添加」确认
     * @param {HTMLElement} anchorBtn - 触发按钮元素
     * @param {Object} content - 视频/文章对象
     */
    showCardCategoryMenu(anchorBtn, content) {
        // 移除已有的菜单
        var existing = document.querySelector('.card-category-menu');
        if (existing) existing.remove();

        // 如果没有分类，提示创建
        if (this.categories.length === 0) {
            this.showError('请先创建分类（点击「创建分类」按钮）');
            return;
        }

        var self = this;
        var menu = document.createElement('div');
        menu.className = 'card-category-menu';

        var title = document.createElement('div');
        title.className = 'card-category-menu-title';
        title.textContent = '选择分类';
        menu.appendChild(title);

        // 分类列表容器
        var listContainer = document.createElement('div');
        listContainer.className = 'card-category-menu-list';

        var selectedCategoryId = null;

        this.categories.forEach(cat => {
            var inCat = cat.videoIds.includes(content.id);
            var item = document.createElement('div');
            item.className = 'card-category-menu-item' + (inCat ? ' already-in' : '');
            item.innerHTML = '<span class="card-category-menu-name">' + this.escapeHtml(cat.name) + '</span>' +
                '<span class="card-category-menu-count">(' + cat.videoIds.length + ')</span>' +
                (inCat ? '<span class="card-category-menu-badge">已添加</span>' : '');

            item.addEventListener('click', function() {
                // 取消之前的选中
                listContainer.querySelectorAll('.card-category-menu-item').forEach(function(el) {
                    el.classList.remove('selected');
                });
                item.classList.add('selected');
                selectedCategoryId = cat.id;

                if (inCat) {
                    // 已添加的分类：启用移出按钮，禁用添加按钮
                    removeBtn.disabled = false;
                    addBtn.disabled = true;
                } else {
                    // 未添加的分类：启用添加按钮，禁用移出按钮
                    addBtn.disabled = false;
                    removeBtn.disabled = true;
                }
            });

            listContainer.appendChild(item);
        });
        menu.appendChild(listContainer);

        // 底部操作栏
        var footer = document.createElement('div');
        footer.className = 'card-category-menu-footer';

        var cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-secondary btn-sm';
        cancelBtn.textContent = '取消';
        cancelBtn.addEventListener('click', function() {
            menu.remove();
            document.removeEventListener('mousedown', closeHandler);
        });

        var addBtn = document.createElement('button');
        addBtn.className = 'btn btn-primary btn-sm';
        addBtn.textContent = '添加';
        addBtn.disabled = true; // 初始禁用，选中分类后启用

        var removeBtn = document.createElement('button');
        removeBtn.className = 'btn btn-danger btn-sm';
        removeBtn.textContent = '移出';
        removeBtn.disabled = true; // 初始禁用，选中已包含的分类后启用

        addBtn.addEventListener('click', function() {
            if (!selectedCategoryId) return;
            var cat = self.categories.find(function(c) { return c.id === selectedCategoryId; });
            if (cat) {
                self.addVideoToCategory(cat.id, content.id);
                self.showSuccess('已将「' + content.title + '」添加到分类 "' + cat.name + '"');
                // 如果当前正在按该分类筛选，刷新视图
                if (self.currentCategoryFilter === cat.id) {
                    self.renderCurrentView();
                }
                // 刷新分类显示计数
                self.renderCategories();
            }
            menu.remove();
            document.removeEventListener('mousedown', closeHandler);
        });

        removeBtn.addEventListener('click', function() {
            if (!selectedCategoryId) return;
            var cat = self.categories.find(function(c) { return c.id === selectedCategoryId; });
            if (cat) {
                self.removeVideoFromCategory(cat.id, content.id);
                self.showSuccess('已将「' + content.title + '」从分类 "' + cat.name + '" 中移出');
                // 如果当前正在按该分类筛选，刷新视图
                if (self.currentCategoryFilter === cat.id) {
                    self.renderCurrentView();
                }
                // 刷新分类显示计数
                self.renderCategories();
            }
            menu.remove();
            document.removeEventListener('mousedown', closeHandler);
        });

        footer.appendChild(cancelBtn);
        footer.appendChild(removeBtn);
        footer.appendChild(addBtn);
        menu.appendChild(footer);

        // 定位到按钮下方或上方（避免超出视口底部）
        var rect = anchorBtn.getBoundingClientRect();
        menu.style.position = 'fixed';
        var menuWidth = 220;
        var leftPos = rect.right - menuWidth;
        if (leftPos < 4) leftPos = 4;
        menu.style.left = leftPos + 'px';

        // 先添加到 DOM 以获取实际高度
        menu.style.visibility = 'hidden';
        document.body.appendChild(menu);
        var menuHeight = menu.offsetHeight;
        var spaceBelow = window.innerHeight - rect.bottom;
        var spaceAbove = rect.top;
        var topPos;
        if (spaceBelow >= menuHeight + 8 || spaceBelow >= spaceAbove) {
            // 下方有足够空间，或下方比上方空间大
            topPos = rect.bottom + 4;
        } else {
            // 上方空间更大，显示在按钮上方
            topPos = rect.top - menuHeight - 4;
            if (topPos < 4) topPos = 4;
        }
        menu.style.top = topPos + 'px';
        menu.style.visibility = 'visible';

        // 点击菜单外部关闭
        var closeHandler = function(e) {
            if (!menu.contains(e.target) && e.target !== anchorBtn) {
                menu.remove();
                document.removeEventListener('mousedown', closeHandler);
            }
        };
        setTimeout(function() {
            document.addEventListener('mousedown', closeHandler);
        }, 0);
    }

    // ==================== 批量管理功能 ====================

    toggleBatchMode() {
        if (!this.isDeveloper) {
            this.showError('您没有权限执行此操作');
            return;
        }
        this.batchMode = !this.batchMode;
        if (!this.batchMode) {
            this.selectedVideoIds.clear();
        }

        if (this.elements.batchToolbar) {
            this.elements.batchToolbar.classList.toggle('hidden', !this.batchMode);
        }
        if (this.elements.batchManageBtn) {
            this.elements.batchManageBtn.textContent = this.batchMode ? '退出管理' : '批量管理';
        }

        this.updateBatchSelectedCount();
        this.renderCurrentView();
    }

    toggleVideoSelection(videoId, selected, card) {
        if (selected) {
            this.selectedVideoIds.add(videoId);
            card?.classList.add('batch-selected');
        } else {
            this.selectedVideoIds.delete(videoId);
            card?.classList.remove('batch-selected');
        }
        // 同步复选框状态
        const checkbox = card?.querySelector('.batch-card-checkbox');
        if (checkbox && checkbox.checked !== selected) {
            checkbox.checked = selected;
        }
        this.updateBatchSelectedCount();
    }

    selectAllInBatch(selectAll) {
        if (selectAll) {
            this.currentVideos.forEach(v => this.selectedVideoIds.add(v.id));
        } else {
            this.selectedVideoIds.clear();
        }
        // 更新所有卡片的UI
        document.querySelectorAll('.video-card').forEach(card => {
            const videoId = card.dataset.videoId;
            const checkbox = card.querySelector('.batch-card-checkbox');
            if (selectAll && videoId && this.currentVideos.some(v => v.id === videoId)) {
                card.classList.add('batch-selected');
                if (checkbox) checkbox.checked = true;
            } else {
                card.classList.remove('batch-selected');
                if (checkbox) checkbox.checked = false;
            }
        });
        this.updateBatchSelectedCount();
    }

    updateBatchSelectedCount() {
        if (this.elements.batchSelectedCount) {
            this.elements.batchSelectedCount.textContent = this.selectedVideoIds.size;
        }
    }

    async batchDeleteVideos() {
        if (this.selectedVideoIds.size === 0) {
            this.showError('请先选择要删除的内容');
            return;
        }

        const count = this.selectedVideoIds.size;
        if (!confirm('确定要删除选中的 ' + count + ' 条内容吗？此操作不可撤销。')) {
            return;
        }

        this.showLoading('正在批量删除...');
        let successCount = 0;
        let failCount = 0;

        try {
            for (const videoId of this.selectedVideoIds) {
                try {
                    await coreService.deleteVideo(videoId);
                    successCount++;
                } catch (e) {
                    console.error('删除失败:', videoId, e);
                    failCount++;
                }
            }

            this.selectedVideoIds.clear();
            this.updateBatchSelectedCount();

            if (failCount === 0) {
                this.showSuccess('成功删除 ' + successCount + ' 条内容');
            } else {
                this.showError('删除完成：成功 ' + successCount + ' 条，失败 ' + failCount + ' 条');
            }

            // 如果全部删除成功且当前列表为空，退出批量模式
            if (this.currentVideos.length - successCount <= 0) {
                this.toggleBatchMode();
            }
        } catch (error) {
            console.error('批量删除失败:', error);
            this.showError('批量删除失败，请重试');
        } finally {
            this.hideLoading();
        }
    }

    renderEmptyState() {
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.innerHTML = '<div class="empty-icon">📹</div><h3>暂无视频</h3><p>点击"添加视频"按钮开始构建你的知识库</p>';
        this.elements.contentContainer.appendChild(emptyState);
    }

    async renderTagCloud() {
        const tagStats = await coreService.getTagStats();
        this.currentTagStats = tagStats;

        this.elements.tagCloud.innerHTML = '';

        Object.entries(tagStats).forEach(([tag, stats]) => {
            const tagElement = document.createElement('span');
            tagElement.className = 'tag';
            // 如果该标签是当前筛选标签，恢复选中状态
            if (coreService.currentTagFilter === tag) {
                tagElement.classList.add('active');
            }
            tagElement.textContent = tag;
            tagElement.innerHTML += '<span class="count">(' + stats.count + ')</span>';

            tagElement.addEventListener('click', async () => {
                // 如果当前标签已激活，则取消筛选，回到显示全部
                if (coreService.currentTagFilter === tag) {
                    tagElement.classList.remove('active');
                    coreService.clearTagFilter();
                    await this.renderCurrentView();
                    return;
                }

                // 切换标签选中状态
                this.elements.tagCloud.querySelectorAll('.tag').forEach(t => {
                    t.classList.remove('active');
                });
                tagElement.classList.add('active');

                // 清除分类筛选，避免与标签筛选冲突
                if (this.currentCategoryFilter) {
                    this.currentCategoryFilter = null;
                    this.categories.forEach(c => {
                        const el = document.querySelector(`.category-item[data-category-id="${c.id}"]`);
                        if (el) el.classList.remove('active');
                    });
                }

                coreService.setTagFilter(tag);
                // 重新渲染视图以应用标签筛选
                await this.renderCurrentView();
            });

            this.elements.tagCloud.appendChild(tagElement);
        });
    }

    showAddVideoModal(video = null) {
        this.elements.addVideoModal.classList.remove('hidden');
        
        // 重置封面预览和粘贴区域（修复图片残留问题）
        const previewImage = document.getElementById('preview-image');
        if (previewImage) {
            previewImage.src = '';
            previewImage.classList.add('hidden');
        }
        if (this.elements.pasteArea) {
            this.elements.pasteArea.innerHTML = '<p>或直接粘贴图片到此处 (Ctrl+V)</p>';
        }
        
        this.elements.videoUrl.focus();
    }

    hideAddVideoModal() {
        this.elements.addVideoModal.classList.add('hidden');
        this.elements.videoForm.reset();
        this.elements.tagsPreview.innerHTML = '';
        this.editingVideoId = null;
    }

    async handleFormSubmit() {
        // 检查是否为开发者模式
        if (!this.isDeveloper) {
            this.showError('您没有权限执行此操作');
            return;
        }
        
        const formData = new FormData(this.elements.videoForm);
        
        const videoData = {
            type: formData.get('type') || 'video',
            title: formData.get('title'),
            url: formData.get('url'),
            cover: formData.get('cover') || '',
            desc: formData.get('desc') || '',
            tags: Array.from(this.elements.tagsPreview.querySelectorAll('.tag-preview'))
                      .map(tag => tag.dataset.tag)
        };

        try {
            const content = videoData.type === 'article' ? new ArticleInfo(videoData) : new VideoInfo(videoData);
            const errors = content.validate();
            
            if (errors.length > 0) {
                alert('表单验证失败：\n' + errors.join('\n'));
                return;
            }

            if (this.editingVideoId) {
                await coreService.updateVideo(this.editingVideoId, videoData);
                this.editingVideoId = null;
                this.hideAddVideoModal();
                this.showSuccess('内容更新成功');
            } else {
                const saved = await coreService.addVideo(videoData);
                // 自动根据标题分类
                const autoCategoryId = this.getAutoCategoryByTitle(videoData.title);
                if (autoCategoryId) {
                    this.addVideoToCategory(autoCategoryId, saved.id);
                    this.renderCategories();
                }
                this.hideAddVideoModal();
                this.showSuccess('内容添加成功');
            }
        } catch (error) {
            console.error('操作失败:', error);
            this.showError('操作失败，请重试');
        }
    }

    /**
     * 处理封面上传
     */
    handleCoverUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        // 验证文件类型
        if (!file.type.startsWith('image/')) {
            alert('请上传图片文件');
            return;
        }

        // 验证文件大小（限制为5MB）
        if (file.size > 5 * 1024 * 1024) {
            alert('图片文件大小不能超过5MB');
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const base64Image = event.target.result;
            
            // 更新封面URL输入框
            this.elements.videoCover.value = base64Image;
            
            // 显示预览
            const previewImage = document.getElementById('preview-image');
            if (previewImage) {
                previewImage.src = base64Image;
                previewImage.classList.remove('hidden');
            }
        };
        reader.readAsDataURL(file);
    }

    /**
     * 处理粘贴图片（增强版）
     */
    handlePasteImage(e) {
        const items = e.clipboardData?.items;
        if (!items) {
            this.showWarning('无法读取剪贴板内容，请尝试点击粘贴区域后按 Ctrl+V');
            return;
        }

        // 查找图片数据
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
                const file = items[i].getAsFile();
                
                // 验证文件大小（限制为5MB）
                if (file.size > 5 * 1024 * 1024) {
                    alert('图片文件大小不能超过5MB');
                    return;
                }

                this.processImageFile(file);
                break;
            }
        }
    }

    /**
     * 处理拖拽图片
     */
    handleDropImage(e) {
        const files = e.dataTransfer.files;
        if (!files || files.length === 0) return;

        const file = files[0];
        
        // 验证是否为图片
        if (!file.type.startsWith('image/')) {
            this.showError('请拖入图片文件');
            return;
        }

        // 验证文件大小
        if (file.size > 5 * 1024 * 1024) {
            alert('图片文件大小不能超过5MB');
            return;
        }

        this.processImageFile(file);
    }

    /**
     * 处理图片文件的通用方法（转换为base64并设置封面）
     */
    processImageFile(file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const base64Image = event.target.result;
            
            // 更新封面URL输入框
            if (this.elements.videoCover) {
                this.elements.videoCover.value = base64Image;
            }
            
            // 显示预览
            const previewImage = document.getElementById('preview-image');
            if (previewImage) {
                previewImage.src = base64Image;
                previewImage.classList.remove('hidden');
            }

            // 更新粘贴区域状态显示
            if (this.elements.pasteArea) {
                this.elements.pasteArea.innerHTML = '<p style="color: var(--primary-color);">✓ 图片已设置 (' + Math.round(file.size / 1024) + 'KB)</p>';
            }

            this.showSuccess('图片设置成功，可作为封面使用');
        };
        reader.onerror = () => {
            this.showError('图片读取失败，请重试');
        };
        reader.readAsDataURL(file);
    }

    /**
     * 为批量导入预览项的粘贴区域读取图片
     */
    readImageToPreview(file, areaEl, hiddenInput, hintEl) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const base64Image = event.target.result;
            hiddenInput.value = base64Image;
            // 在粘贴区域显示缩略图
            hintEl.style.display = 'none';
            areaEl.innerHTML = `<img src="${base64Image}" style="max-width:100%;max-height:60px;border-radius:4px;display:block;">`;
        };
        reader.onerror = () => {
            this.showError('图片读取失败');
        };
        reader.readAsDataURL(file);
    }

    async smartFillForm() {
        const url = this.elements.videoUrl.value.trim();

        if (!url) {
            alert('请输入链接');
            return;
        }

        this.showLoading('智能填充中...');

        try {
            var info = await this.fetchUrlTitle(url);

            if (this.elements.contentType) {
                var isArticle = url.toLowerCase().includes('/read/') || url.toLowerCase().includes('/cv');
                this.elements.contentType.value = info.type || (isArticle ? 'article' : 'video');
            }
            if (info.title) {
                this.elements.videoTitle.value = info.title;
            } else {
                this.elements.videoTitle.value = '未获取到标题，请手动输入';
            }
            if (info.desc) {
                this.elements.videoDesc.value = info.desc;
            }
            if (info.cover) {
                this.elements.videoCover.value = info.cover;
            }

            this.showSuccess('智能填充完成' + (info.fromCache ? ' (缓存)' : ''));
        } catch (error) {
            console.error('智能填充失败:', error);
            this.showError('智能填充失败，请手动输入');
        } finally {
            this.hideLoading();
        }
    }

    async fetchUrlTitle(url) {
        var result = { title: '', type: 'video', desc: '', cover: '', fromCache: false };

        var cacheKey = 'kb_fetchcache_' + url;
        try {
            var cached = sessionStorage.getItem(cacheKey);
            if (cached) {
                var parsed = JSON.parse(cached);
                if (parsed && parsed.title) {
                    result.title = parsed.title;
                    result.type = parsed.type || 'video';
                    result.desc = parsed.desc || '';
                    result.cover = parsed.cover || '';
                    result.fromCache = true;
                    return result;
                }
            }
        } catch (e) {}

        // 尝试使用 BilibiliCrawler (如果可用)
        if (url.indexOf('bilibili.com') >= 0 || url.indexOf('b23.tv') >= 0) {
            var crawler = this.bilibiliCrawler;
            if (!crawler && typeof BilibiliCrawler !== 'undefined') {
                crawler = new BilibiliCrawler();
            }
            if (crawler && typeof crawler.fetchText === 'function') {
                try {
                    var html = await crawler.fetchText(url, 8000);
                    if (html) {
                        var titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
                        if (titleMatch && titleMatch[1]) {
                            var t = titleMatch[1].replace(/_哔哩哔哩_bilibili$/, '').replace(/-哔哩哔哩$/, '').trim();
                            if (t) {
                                result.title = t;
                            }
                        }
                        var descMatch = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i);
                        if (descMatch && descMatch[1]) {
                            result.desc = descMatch[1].substring(0, 300);
                        }
                        var imgMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
                        if (imgMatch && imgMatch[1]) {
                            result.cover = imgMatch[1];
                        }
                        if (result.title) {
                            try { sessionStorage.setItem(cacheKey, JSON.stringify(result)); } catch(e) {}
                            return result;
                        }
                    }
                } catch (e) {}
            }
        }

        // 通用 fetch 方案
        var attempts = [
            { url: url, raw: true },
            { url: 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url), raw: true },
            { url: 'https://corsproxy.io/?' + encodeURIComponent(url), raw: true }
        ];

        for (var ai = 0; ai < attempts.length; ai++) {
            try {
                var controller = new AbortController();
                var timeoutId = setTimeout(function() { controller.abort(); }, 6000);
                var resp = await fetch(attempts[ai].url, {
                    signal: controller.signal,
                    mode: attempts[ai].raw ? 'cors' : 'cors'
                });
                clearTimeout(timeoutId);

                if (!resp.ok) continue;
                var html = await resp.text();
                if (!html || html.length < 50) continue;

                var titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
                if (titleMatch && titleMatch[1]) {
                    result.title = titleMatch[1].replace(/_哔哩哔哩_bilibili$/, '').replace(/-哔哩哔哩$/, '').replace(/_bilibili$/, '').trim();
                }
                var descMatch = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i);
                if (descMatch && descMatch[1]) {
                    result.desc = descMatch[1].substring(0, 300);
                }
                var imgMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
                if (imgMatch && imgMatch[1]) {
                    result.cover = imgMatch[1];
                }
                if (!result.title) {
                    var h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
                    if (h1Match && h1Match[1]) {
                        result.title = h1Match[1].trim();
                    }
                }
                if (result.title) {
                    try { sessionStorage.setItem(cacheKey, JSON.stringify(result)); } catch(e) {}
                    return result;
                }
            } catch (e) {}
        }

        return result;
    }

    addTagFromInput() {
        const input = this.elements.videoTags;
        const tag = input.value.trim();
        
        if (tag) {
            this.addTag(tag);
            input.value = '';
        }
    }

    addTag(tag) {
        const tagElement = document.createElement('span');
        tagElement.className = 'tag-preview';
        tagElement.dataset.tag = tag;
        tagElement.innerHTML = this.escapeHtml(tag) + '<span class="remove" onclick="this.parentElement.remove()">×</span>';
        
        this.elements.tagsPreview.appendChild(tagElement);
    }

    editVideo(video) {
        this.editingVideoId = video.id;
        
        // 设置内容类型（视频/文章）
        if (this.elements.contentType) {
            this.elements.contentType.value = video.type || 'video';
        }
        
        this.elements.videoUrl.value = video.url;
        this.elements.videoTitle.value = video.title;
        this.elements.videoCover.value = video.cover || '';
        this.elements.videoDesc.value = video.desc || '';
        
        // 恢复封面预览
        if (video.cover) {
            var previewImage = document.getElementById('preview-image');
            if (previewImage) {
                previewImage.src = video.cover;
                previewImage.classList.remove('hidden');
            }
        }
        
        this.elements.tagsPreview.innerHTML = '';
        if (video.tags && video.tags.length > 0) {
            video.tags.forEach(tag => this.addTag(tag));
        }
        
        this.showAddVideoModal();
    }

    async deleteVideo(videoId) {
        if (!confirm('确定要删除这个视频吗？此操作不可撤销。')) {
            return;
        }

        try {
            await coreService.deleteVideo(videoId);
            this.showSuccess('视频删除成功');
        } catch (error) {
            console.error('删除视频失败:', error);
            this.showError('删除视频失败，请重试');
        }
    }

    async exportData() {
        try {
            const data = await videoDB.exportData();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = 'video-knowledge-export-' + new Date().toISOString().split('T')[0] + '.json';
            a.click();
            
            URL.revokeObjectURL(url);
            this.showSuccess('数据导出成功');
        } catch (error) {
            console.error('导出数据失败:', error);
            this.showError('导出数据失败，请重试');
        }
    }

    async loadMoreVideos() {
        // 分页模式：不使用无限滚动加载更多
    }

    showLoading(message = '加载中...') {
        this.elements.loadingIndicator.classList.remove('hidden');
        if (message) {
            this.elements.loadingIndicator.querySelector('span').textContent = message;
        }
    }

    hideLoading() {
        this.elements.loadingIndicator.classList.add('hidden');
    }

    showSuccess(message) {
        this.showToast(message, 'success');
    }

    showError(message) {
        this.showToast(message, 'error');
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = 'toast toast-' + type;
        toast.textContent = message;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('show');
        }, 100);
        
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 300);
        }, 3000);
    }

    escapeHtml(unsafe) {
        if (!unsafe) return '';
        return String(unsafe)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    loadCategories() {
        const saved = localStorage.getItem('videoCategories');
        this.categories = saved ? JSON.parse(saved) : [];

        // 确保三个固定分类存在
        const fixedCategories = [
            { name: '硬核战双', id: 'cat_fixed_hardcore' },
            { name: '硬核战双（文字版）', id: 'cat_fixed_hardcore_text' },
            { name: '潮声回响', id: 'cat_fixed_chaosheng' }
        ];

        fixedCategories.forEach(fc => {
            const existing = this.categories.find(c => c.name === fc.name);
            if (existing) {
                // 如果同名分类已存在，确保使用正确的固定ID并标记为固定分类
                existing.id = fc.id;
                existing.isFixed = true;
            } else {
                this.categories.push({
                    id: fc.id,
                    name: fc.name,
                    videoIds: [],
                    created: Date.now(),
                    isFixed: true  // 标记为固定分类
                });
            }
        });

        this.saveCategories();
    }

    saveCategories() {
        localStorage.setItem('videoCategories', JSON.stringify(this.categories));
    }

    createCategory(name) {
        const category = {
            id: 'cat_' + Date.now(),
            name: name,
            videoIds: [],
            created: Date.now()
        };
        this.categories.push(category);
        this.saveCategories();
        this.renderCategories();
        return category;
    }

    deleteCategory(categoryId) {
        this.categories = this.categories.filter(c => c.id !== categoryId);
        this.saveCategories();
        this.renderCategories();
    }

    addVideoToCategory(categoryId, videoId) {
        const category = this.categories.find(c => c.id === categoryId);
        if (category && !category.videoIds.includes(videoId)) {
            category.videoIds.push(videoId);
            this.saveCategories();
        }
    }

    removeVideoFromCategory(categoryId, videoId) {
        const category = this.categories.find(c => c.id === categoryId);
        if (category) {
            category.videoIds = category.videoIds.filter(id => id !== videoId);
            this.saveCategories();
        }
    }

    /**
     * 根据视频标题自动匹配固定分类
     * 按优先级顺序检测（更具体的匹配优先）
     * @param {string} title - 视频标题
     * @returns {string|null} - 匹配的分类ID，未匹配返回null
     */
    getAutoCategoryByTitle(title) {
        if (!title) return null;

        // 标准化标题：统一半角括号为全角括号，避免因括号差异导致匹配失败
        var normalizedTitle = String(title).replace(/\(/g, '（').replace(/\)/g, '）');

        var categoryName = null;

        // 必须先检测「硬核战双（文字版）」，因为它包含「硬核战双」
        if (normalizedTitle.includes('硬核战双（文字版）')) {
            categoryName = '硬核战双（文字版）';
        } else if (normalizedTitle.includes('硬核战双')) {
            categoryName = '硬核战双';
        } else if (normalizedTitle.includes('潮声回响')) {
            categoryName = '潮声回响';
        }

        // 按名称查找分类，确保即使分类ID不一致也能正确匹配
        if (categoryName) {
            var category = this.categories.find(function(c) { return c.name === categoryName; });
            if (category) {
                return category.id;
            }
            console.warn('[自动分类] 找到匹配的分类名 "' + categoryName + '" 但分类列表中不存在该分类');
        }

        return null;
    }

    /**
     * 手动扫描所有已导入的视频，根据标题自动添加到对应分类
     */
    async autoScanCategorize() {
        try {
            // 确保固定分类已加载
            this.loadCategories();

            if (!videoDB) {
                this.showError('数据库未初始化，无法扫描');
                return;
            }

            const allVideos = await videoDB.getAllVideos();
            if (allVideos.length === 0) {
                this.showError('暂无可扫描的视频');
                return;
            }

            let categorizedCount = 0;
            let alreadyInCategoryCount = 0;
            let noMatchCount = 0;
            const self = this;

            allVideos.forEach(function(video) {
                const categoryId = self.getAutoCategoryByTitle(video.title);
                if (categoryId) {
                    // 检查是否已在分类中，避免重复添加
                    const category = self.categories.find(function(c) { return c.id === categoryId; });
                    if (category) {
                        var vid = String(video.id);
                        var alreadyIn = category.videoIds.some(function(id) {
                            return String(id) === vid;
                        });
                        if (!alreadyIn) {
                            self.addVideoToCategory(categoryId, video.id);
                            categorizedCount++;
                        } else {
                            alreadyInCategoryCount++;
                        }
                    } else {
                        console.warn('[自动扫描] 分类ID "' + categoryId + '" 在分类列表中未找到');
                    }
                } else {
                    noMatchCount++;
                }
            });

            console.log('[自动扫描] 总计 ' + allVideos.length + ' 条视频，新增分类 ' + categorizedCount + ' 条，已在分类中 ' + alreadyInCategoryCount + ' 条，无匹配 ' + noMatchCount + ' 条');

            if (categorizedCount > 0) {
                this.renderCategories();
                this.showSuccess('自动扫描完成，共新增分类 ' + categorizedCount + ' 条内容');
            } else if (alreadyInCategoryCount > 0) {
                this.showSuccess('自动扫描完成，符合分类的 ' + alreadyInCategoryCount + ' 条内容已在分类中');
            } else {
                this.showSuccess('自动扫描完成，未找到符合分类条件的视频（共扫描 ' + allVideos.length + ' 条）');
            }
        } catch (error) {
            console.error('自动扫描分类失败:', error);
            this.showError('自动扫描分类失败: ' + (error.message || error));
        }
    }

    async renderCategories() {
        const container = document.getElementById('categories-container');
        if (!container) return;

        container.innerHTML = '';

        // 获取所有视频数据用于显示标题
        var allVideos = [];
        try {
            allVideos = await videoDB.getAllVideos();
        } catch (e) {
            console.warn('获取视频列表失败:', e);
        }
        var videoMap = {};
        allVideos.forEach(function(v) {
            videoMap[v.id] = v;
        });

        this.categories.forEach(category => {
            const catEl = document.createElement('div');
            catEl.className = 'category-item';
            catEl.dataset.categoryId = category.id;

            // 分类头部（名称 + 计数 + 删除按钮 + 展开箭头）
            var headerHtml = '<span class="category-name">' + this.escapeHtml(category.name) + '</span>' +
                '<span class="category-count">(' + category.videoIds.length + ')</span>';
            if (this.isDeveloper) {
                headerHtml += '<button class="btn-delete-category" data-category-id="' + category.id + '" title="删除分类">×</button>';
            }
            headerHtml += '<span class="category-toggle-arrow">▼</span>';

            const header = document.createElement('div');
            header.className = 'category-header';
            header.innerHTML = headerHtml;
            catEl.appendChild(header);

            // 展开的内容区域：显示分类中的链接列表
            const contentArea = document.createElement('div');
            contentArea.className = 'category-content';
            contentArea.style.display = 'none'; // 默认收起

            if (category.videoIds.length === 0) {
                contentArea.innerHTML = '<div class="category-empty">暂无内容</div>';
            } else {
                category.videoIds.forEach(function(videoId) {
                    var video = videoMap[videoId];
                    var item = document.createElement('div');
                    item.className = 'category-video-item';
                    item.dataset.videoId = videoId;
                    var title = video ? video.title : '未知内容';
                    var typeLabel = video ? (video.type === 'article' ? '【文章】' : '【视频】') : '';
                    item.innerHTML = '<span class="category-video-title" title="' + this.escapeHtml(title) + '">' +
                        typeLabel + this.escapeHtml(title) + '</span>';
                    if (this.isDeveloper) {
                        item.innerHTML += '<button class="btn-remove-from-category" title="从分类中移除">×</button>';
                    }
                    contentArea.appendChild(item);
                }.bind(this));
            }
            catEl.appendChild(contentArea);

            // 拖拽事件（仅头部响应）
            header.addEventListener('dragover', (e) => {
                e.preventDefault();
                catEl.classList.add('drag-over');
            });
            header.addEventListener('dragleave', () => {
                catEl.classList.remove('drag-over');
            });
            header.addEventListener('drop', (e) => {
                e.preventDefault();
                catEl.classList.remove('drag-over');
                if (this.draggedVideoId) {
                    this.addVideoToCategory(category.id, this.draggedVideoId);
                    this.showSuccess('已将视频添加到分类 "' + category.name + '"');
                    this.renderCategories();
                }
            });

            // 点击头部：展开/收起 或 筛选
            header.addEventListener('click', (e) => {
                // 避免点击删除按钮时触发
                if (e.target.classList.contains('btn-delete-category')) {
                    return;
                }

                // 如果当前分类已激活筛选，则取消筛选
                if (this.currentCategoryFilter === category.id) {
                    this.clearCategoryFilter();
                    catEl.classList.remove('active');
                    return;
                }

                // 切换展开/收起状态
                var isExpanded = contentArea.style.display !== 'none';
                contentArea.style.display = isExpanded ? 'none' : 'block';
                header.querySelector('.category-toggle-arrow').textContent = isExpanded ? '▼' : '▲';

                // 激活筛选状态
                this.categories.forEach(c => {
                    const el = document.querySelector(`.category-item[data-category-id="${c.id}"]`);
                    if (el) {
                        el.classList.remove('active');
                    }
                });
                catEl.classList.add('active');

                // 清除标签筛选
                if (coreService.currentTagFilter) {
                    coreService.clearTagFilter();
                    this.elements.tagCloud.querySelectorAll('.tag').forEach(t => {
                        t.classList.remove('active');
                    });
                }

                this.filterByCategory(category.id);
            });

            // 删除分类按钮事件
            const deleteBtn = header.querySelector('.btn-delete-category');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm('确定要删除分类 "' + category.name + '" 吗？')) {
                        this.deleteCategory(category.id);
                        this.showSuccess('分类删除成功');
                    }
                });
            }

            // 从分类中移除链接的事件（委托到 contentArea）
            if (this.isDeveloper) {
                contentArea.addEventListener('click', (e) => {
                    var removeBtn = e.target.closest('.btn-remove-from-category');
                    if (!removeBtn) return;
                    var item = removeBtn.closest('.category-video-item');
                    if (!item) return;
                    var videoId = item.dataset.videoId;
                    var video = videoMap[videoId];
                    var title = video ? video.title : '该内容';
                    if (confirm('确定要将「' + title + '」从分类 "' + category.name + '" 中移除吗？')) {
                        this.removeVideoFromCategory(category.id, videoId);
                        this.showSuccess('已从分类中移除');
                        // 如果当前正在按该分类筛选，刷新视图
                        if (this.currentCategoryFilter === category.id) {
                            this.renderCurrentView();
                        }
                        this.renderCategories();
                    }
                });
            }

            container.appendChild(catEl);
        });
    }

    showAddCategoryModal() {
        const name = prompt('请输入新分类名称:');
        if (name && name.trim()) {
            // 检查分类名称是否已存在
            const existingCategory = this.categories.find(c => c.name === name.trim());
            if (existingCategory) {
                this.showError('分类名称已存在');
                return;
            }
            this.createCategory(name.trim());
            this.showSuccess('分类创建成功');
        }
    }

    // ==================== 批量导入功能 ====================

    /**
     * 初始化批量导入事件监听器
     */
    initBatchImportListeners() {
        if (!this.elements.batchImportModal) return;

        // 关闭模态框
        this.elements.closeBatchModal?.addEventListener('click', () => {
            this.hideBatchImportModal();
        });
        this.elements.cancelBatchModal?.addEventListener('click', () => {
            this.hideBatchImportModal();
        });

        // 从剪贴板粘贴
        this.elements.batchPasteBtn?.addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                if (text) {
                    this.elements.batchUrlInput.value += (this.elements.batchUrlInput.value ? '\n' : '') + text;
                    this.updateBatchUrlCount();
                    this.showSuccess('已从剪贴板粘贴链接');
                }
            } catch (e) {
                this.showError('无法读取剪贴板，请手动粘贴（Ctrl+V）');
            }
        });

        // 清空
        this.elements.batchClearBtn?.addEventListener('click', () => {
            this.elements.batchUrlInput.value = '';
            this.updateBatchUrlCount();
            this.elements.batchPreviewArea.classList.add('hidden');
            this.elements.batchStartBtn.classList.add('hidden');
            this.elements.batchPreviewBtn.classList.remove('hidden');
        });

        // 输入变化时更新计数
        this.elements.batchUrlInput?.addEventListener('input', () => {
            this.updateBatchUrlCount();
        });

        // 预览按钮
        this.elements.batchPreviewBtn?.addEventListener('click', () => {
            this.previewBatchUrls();
        });

        // 开始导入按钮
        this.elements.batchStartBtn?.addEventListener('click', () => {
            this.startBatchImport();
        });
    }

    /**
     * 显示批量导入模态框
     */
    showBatchImportModal() {
        if (!this.isDeveloper) {
            this.showError('您没有权限执行此操作');
            return;
        }
        this.elements.batchImportModal?.classList.remove('hidden');
        // 重置状态
        this.elements.batchUrlInput.value = '';
        this.updateBatchUrlCount();
        this.elements.batchPreviewArea.classList.add('hidden');
        this.elements.batchProgressArea.classList.add('hidden');
        this.elements.batchStartBtn.classList.add('hidden');
        this.elements.batchPreviewBtn.classList.remove('hidden');
        this.elements.batchTags.value = '';
    }

    /**
     * 隐藏批量导入模态框
     */
    hideBatchImportModal() {
        this.elements.batchImportModal?.classList.add('hidden');
    }

    /**
     * 更新链接计数
     */
    updateBatchUrlCount() {
        const urls = this.parseBatchUrls(this.elements.batchUrlInput?.value || '');
        if (this.elements.batchUrlCount) {
            this.elements.batchUrlCount.textContent = urls.length;
        }
    }

    /**
     * 解析输入的URL列表
     */
    parseBatchUrls(text) {
        return text
            .split(/[\n\r,;]+/)
            .map(url => url.trim())
            .filter(url => url && this.isValidUrl(url));
    }

    /**
     * 检测链接类型
     */
    detectContentType(url) {
        const lower = url.toLowerCase();
        if (lower.includes('/video/') || lower.includes('/watch') || lower.includes('/bilibili.com/video')) {
            return 'video';
        }
        if (lower.includes('/read/') || lower.includes('/cv') || lower.includes('medium.com') || lower.includes('zhihu.com')) {
            return 'article';
        }
        return this.elements.batchDefaultType?.value !== 'auto' ? this.elements.batchDefaultType?.value : 'video';
    }

    /**
     * 从URL提取标题信息
     */
    extractInfoFromUrl(url) {
        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname;

            let title = '';
            let type = this.detectContentType(url);

            // B站视频
            if (hostname.includes('bilibili.com') && urlObj.pathname.includes('/video/')) {
                const bvid = urlObj.pathname.match(/\/video\/(BV\w+)/)?.[1] || '';
                title = bvid ? `[B站视频] ${bvid}` : `[B站视频] ${urlObj.pathname}`;
            }
            // B站文章
            else if (hostname.includes('bilibili.com') && urlObj.pathname.includes('/read/')) {
                const cvId = urlObj.pathname.match(/\/read\/cv(\d+)/)?.[1] || '';
                title = cvId ? `[B站专栏] CV${cvId}` : `[B站专栏] ${urlObj.pathname}`;
            }
            // YouTube
            else if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
                const vParam = urlObj.searchParams.get('v') || urlObj.pathname.split('/').pop();
                title = `[YouTube] ${vParam}`;
            }
            // 其他
            else {
                const pathName = decodeURIComponent(urlObj.pathname).replace(/^\//, '').replace(/\/$/, '');
                title = pathName || hostname;
                title = title.substring(0, 50) + (title.length > 50 ? '...' : '');
            }

            return { title, type, url };
        } catch (e) {
            return { title: url, type: 'video', url };
        }
    }

    /**
     * 预览批量导入的链接
     */
    previewBatchUrls() {
        const text = this.elements.batchUrlInput?.value || '';
        const urls = this.parseBatchUrls(text);

        if (urls.length === 0) {
            this.showError('未检测到有效的URL，请检查输入格式');
            return;
        }

        const defaultType = this.elements.batchDefaultType?.value || 'auto';
        const tagsStr = this.elements.batchTags?.value || '';
        const defaultTags = tagsStr.split(/[,\s，、]+/).filter(t => t.trim());

        const items = urls.map((url, index) => {
            const info = this.extractInfoFromUrl(url);
            const finalType = defaultType === 'auto' ? info.type : defaultType;
            return { index: index + 1, ...info, type: finalType, tags: [...defaultTags] };
        });

        // 渲染预览列表
        const previewItemsHtml = items.map((item, idx) => `
            <div class="batch-preview-item" data-url="${this.escapeHtml(item.url)}" data-type="${item.type}" data-index="${idx}">
                <div class="preview-item-header">
                    <span class="preview-item-num">#${item.index}</span>
                    <span class="preview-item-type ${item.type}">${item.type === 'video' ? '视频' : '文章'}</span>
                </div>
                <div class="preview-item-title">${this.escapeHtml(item.title)}</div>
                <div class="preview-item-url">${this.escapeHtml(item.url)}</div>
                <div class="preview-item-edit-area">
                    <div class="preview-edit-row">
                        <label class="preview-edit-label">标题:</label>
                        <input type="text" class="preview-item-title-edit" value="${this.escapeHtml(item.title)}" placeholder="编辑标题">
                    </div>
                    <div class="preview-edit-row">
                        <label class="preview-edit-label">封面:</label>
                        <div class="preview-paste-area" data-index="${idx}" contenteditable="true">
                            <span class="preview-paste-hint">点击此处 Ctrl+V 粘贴图片，或拖拽图片到此处</span>
                        </div>
                        <input type="hidden" class="preview-item-cover-hidden" value="">
                    </div>
                    <div class="preview-edit-row">
                        <label class="preview-edit-label">标签:</label>
                        <input type="text" class="preview-item-tags-edit" value="${this.escapeHtml(item.tags.join(', '))}" placeholder="标签，逗号分隔">
                    </div>
                </div>
                <button class="btn btn-sm btn-secondary preview-item-remove">移除</button>
            </div>
        `).join('');

        this.elements.batchPreviewList.innerHTML = previewItemsHtml;

        this.elements.batchPreviewCount.textContent = items.length;
        this.elements.batchPreviewArea.classList.remove('hidden');
        this.elements.batchStartBtn.classList.remove('hidden');
        this.elements.batchPreviewBtn.classList.add('hidden');

        // 绑定移除事件
        this.elements.batchPreviewList.querySelectorAll('.preview-item-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const item = e.target.closest('.batch-preview-item');
                item.style.display = 'none';
                // 同时从文本域中移除
                const urlToRemove = item.dataset.url;
                const currentText = this.elements.batchUrlInput.value.split('\n').filter(line => !line.includes(urlToRemove)).join('\n');
                this.elements.batchUrlInput.value = currentText;
                this.updateBatchUrlCount();
            });
        });

        // 绑定各预览项的图片粘贴和拖拽事件
        this.elements.batchPreviewList.querySelectorAll('.preview-paste-area').forEach(area => {
            const itemEl = area.closest('.batch-preview-item');
            const hiddenInput = itemEl.querySelector('.preview-item-cover-hidden');
            const hintEl = area.querySelector('.preview-paste-hint');

            area.addEventListener('paste', (e) => {
                e.preventDefault();
                const items = e.clipboardData?.items;
                if (!items) return;
                for (let i = 0; i < items.length; i++) {
                    if (items[i].type.startsWith('image/')) {
                        const file = items[i].getAsFile();
                        if (file && file.size <= 5 * 1024 * 1024) {
                            this.readImageToPreview(file, area, hiddenInput, hintEl);
                        }
                        break;
                    }
                }
            });

            area.addEventListener('dragover', (e) => {
                e.preventDefault();
                area.classList.add('paste-dragover');
            });
            area.addEventListener('dragleave', () => {
                area.classList.remove('paste-dragover');
            });
            area.addEventListener('drop', (e) => {
                e.preventDefault();
                area.classList.remove('paste-dragover');
                const files = e.dataTransfer?.files;
                if (files && files.length > 0) {
                    const file = files[0];
                    if (file.type.startsWith('image/') && file.size <= 5 * 1024 * 1024) {
                        this.readImageToPreview(file, area, hiddenInput, hintEl);
                    }
                }
            });

            area.addEventListener('focus', () => area.classList.add('paste-active'));
            area.addEventListener('blur', () => {
                area.classList.remove('paste-active');
                if (!hiddenInput.value) {
                    hintEl.style.display = '';
                }
            });
        });

        this.showSuccess(`已解析 ${items.length} 个链接，点击"开始导入"确认`);
    }

    /**
     * 开始执行批量导入
     */
    async startBatchImport() {
        const items = Array.from(this.elements.batchPreviewList.querySelectorAll('.batch-preview-item:not([style*="display: none"])'));
        
        if (items.length === 0) {
            this.showError('没有可导入的内容');
            return;
        }

        // 显示进度条
        this.elements.batchProgressArea.classList.remove('hidden');
        this.elements.batchStartBtn.disabled = true;
        this.elements.batchStartBtn.textContent = '导入中...';

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            
            // 更新进度
            const progress = ((i + 1) / items.length) * 100;
            this.elements.batchProgressBar.style.width = `${progress}%`;
            this.elements.batchProgressText.textContent = `正在处理 (${i + 1}/${items.length})...`;

            // 获取用户编辑过的字段
            const titleInput = item.querySelector('.preview-item-title-edit');
            const title = titleInput?.value || item.querySelector('.preview-item-title')?.textContent || '';

            const coverInput = item.querySelector('.preview-item-cover-hidden');
            const cover = coverInput?.value || '';

            const tagsInput = item.querySelector('.preview-item-tags-edit');
            const tagsStr = tagsInput?.value || '';
            const tags = tagsStr.split(/[,\s，、]+/).filter(t => t.trim());

            // 检测类型
            const typeEl = item.querySelector('.preview-item-type');
            const type = typeEl?.classList.contains('article') ? 'article' : 'video';

            const videoData = {
                type,
                title,
                url: item.dataset.url,
                cover,
                desc: '',
                tags
            };

            try {
                // 跳过已存在的链接
                var exists = await coreService.isUrlExists(item.dataset.url);
                if (exists) {
                    failCount++;
                    continue;
                }
                const saved = await coreService.addVideo(videoData);
                // 自动根据标题分类
                const autoCategoryId = this.getAutoCategoryByTitle(title);
                if (autoCategoryId) {
                    this.addVideoToCategory(autoCategoryId, saved.id);
                }
                successCount++;
            } catch (error) {
                console.error(`导入失败 [${title}]:`, error);
                failCount++;
            }

            // 短暂延迟，避免过快请求
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // 完成
        this.elements.batchProgressBar.style.width = '100%';
        this.elements.batchProgressText.textContent = `完成！成功: ${successCount}, 失败: ${failCount}`;

        this.showSuccess(`批量导入完成：成功 ${successCount} 条，失败 ${failCount} 条`);

        // 延迟关闭
        setTimeout(() => {
            this.hideBatchImportModal();
            this.renderCategories();
            this.renderCurrentView();
        }, 1500);
    }
}

let uiManager = null;

function initUIManager() {
    if (!uiManager) {
        uiManager = new UIManager();
    }
    return uiManager;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { UIManager, uiManager, initUIManager };
}
