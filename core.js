class CoreService {
    constructor() {
        this.currentMode = MODE.TIMELINE;
        this.currentQuery = '';
        this.currentTagFilter = null;
        this.isLoading = false;
        this.searchIndex = null;
        this.searchCallbacks = new Map();
        this.searchRequestId = 0;
        this.eventListeners = new Map();
        this._videoCache = [];
        this._cacheVersion = 0;
        this._backupTimer = null;

        this.initSearch();
        this.initEventHandlers();
        this.initBackupListener();
    }

    addEventListener(event, callback) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event).push(callback);
    }

    triggerEvent(event, data) {
        if (this.eventListeners.has(event)) {
            this.eventListeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error('事件处理失败:', error);
                }
            });
        }
    }

    initSearch() {
        this.initMainThreadSearch();
    }

    initMainThreadSearch() {
        try {
            if (typeof FlexSearch === 'undefined') {
                console.warn('FlexSearch库未加载');
                this.searchIndex = null;
                return;
            }

            this.searchIndex = new FlexSearch.Document({
                tokenize: "full",
                resolution: 5,
                depth: 2,
                threshold: 1,
                encode: "advanced",
                document: {
                    id: "id",
                    index: [
                        { field: "title", tokenize: "full", resolution: 5, context: true, boost: 2 },
                        { field: "desc", tokenize: "full", resolution: 5, context: true, boost: 1 },
                        { field: "tags", tokenize: "full", resolution: 5, context: true, boost: 1.5 }
                    ]
                }
            });
        } catch (error) {
            console.warn('FlexSearch初始化失败，使用简单搜索:', error);
            this.searchIndex = null;
        }
    }

    initEventHandlers() {
        this.debouncedSearch = this.debounce(this.performSearch.bind(this), 300);
    }

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    async refreshVideoCache() {
        try {
            this._videoCache = await videoDB.getAllVideos();
            this._cacheVersion++;
        } catch (e) {
            console.warn('刷新视频缓存失败:', e);
        }
    }

    async updateSearchIndex(videos = null) {
        if (!videos) {
            await this.refreshVideoCache();
            videos = this._videoCache;
        }

        if (this.searchIndex) {
            try {
                this.searchIndex.clear();
                videos.forEach(video => {
                    this.searchIndex.add({
                        id: video.id,
                        title: video.title || '',
                        desc: video.desc || '',
                        tags: Array.isArray(video.tags) ? video.tags.join(' ') : (video.tags || '')
                    });
                });
            } catch (error) {
                console.warn('更新搜索索引失败:', error);
            }
        }
    }

    async performSearch(query, callback) {
        this.currentQuery = query;

        if (!query.trim()) {
            const allVideos = this._videoCache.length > 0 ? this._videoCache : await videoDB.getAllVideos();
            callback(allVideos);
            return;
        }

        // 先用 FlexSearch 搜索（支持多字段 Document）
        if (this.searchIndex) {
            try {
                var rawResults = this.searchIndex.search(query, { limit: 200, threshold: 1 });
                var idSet = new Set();
                // Document.search 返回 [{ field, result: [{ id, score }] }]
                rawResults.forEach(function(fieldResult) {
                    (fieldResult.result || []).forEach(function(item) {
                        idSet.add(item.id);
                    });
                });

                var cache = this._videoCache.length > 0 ? this._videoCache : await videoDB.getAllVideos();
                var matched = cache.filter(function(v) { return idSet.has(v.id); });

                // 若 FlexSearch 有结果直接返回
                if (matched.length > 0) {
                    callback(matched);
                    return;
                }
            } catch (e) {
                console.warn('FlexSearch 搜索失败，降级到简单搜索:', e);
            }
        }

        // 降级：简单包含搜索
        try {
            var videos = await videoDB.searchVideos(query);
            callback(videos);
        } catch (e) {
            console.error('搜索失败:', e);
            callback([]);
        }
    }

    handleSearchResults(results, requestId) {
        const callback = this.searchCallbacks.get(requestId);
        if (callback) {
            callback(results);
            this.searchCallbacks.delete(requestId);
        }
    }

    handleSearchError(error, requestId) {
        const callback = this.searchCallbacks.get(requestId);
        if (callback) {
            console.error('搜索失败:', error);
            callback([]);
            this.searchCallbacks.delete(requestId);
        }
    }

    async getVideosByIds(ids) {
        if (ids.length === 0) return [];
        const cache = this._videoCache.length > 0 ? this._videoCache : await videoDB.getAllVideos();
        const idSet = new Set(ids);
        return cache.filter(video => idSet.has(video.id));
    }

    async switchMode(mode) {
        this.currentMode = mode;
        this.currentTagFilter = null;
        localStorage.setItem('currentMode', mode);
        this.triggerEvent('modeChanged', { mode });
    }

    setTagFilter(tag) {
        this.currentTagFilter = tag;
        this.triggerEvent('tagFilterChanged', { tag });
    }

    clearTagFilter() {
        this.currentTagFilter = null;
        this.triggerEvent('tagFilterChanged', { tag: null });
    }

    async addVideo(videoData) {
        try {
            // 去重检查：相同 URL 不再添加
            var cache = this._videoCache.length > 0 ? this._videoCache : await videoDB.getAllVideos();
            var exists = cache.some(function(item) {
                return item.url && videoData.url && item.url.replace(/\/+$/, '') === videoData.url.replace(/\/+$/, '');
            });
            if (exists) {
                throw new Error('该链接已存在，跳过添加');
            }

            const video = await videoDB.addVideo(videoData);
            await this.updateSearchIndex();
            this.scheduleBackup();
            this.triggerEvent('videoAdded', { video });
            return video;
        } catch (error) {
            console.error('添加视频失败:', error);
            throw error;
        }
    }

    async updateVideo(videoId, updates) {
        try {
            const video = await videoDB.updateVideo(videoId, updates);
            await this.updateSearchIndex();
            this.scheduleBackup();
            this.triggerEvent('videoUpdated', { video });
            return video;
        } catch (error) {
            console.error('更新视频失败:', error);
            throw error;
        }
    }

    async deleteVideo(videoId) {
        try {
            await videoDB.deleteVideo(videoId);
            await this.updateSearchIndex();
            this.scheduleBackup();
            this.triggerEvent('videoDeleted', { videoId });
        } catch (error) {
            console.error('删除视频失败:', error);
            throw error;
        }
    }

    async getTagStats(field = 'tags') {
        return await videoDB.getAllTagsWithStats(field);
    }

    async isUrlExists(url) {
        if (!url) return false;
        var normalized = url.replace(/\/+$/, '');
        var cache = this._videoCache.length > 0 ? this._videoCache : await videoDB.getAllVideos();
        return cache.some(function(item) {
            return item.url && item.url.replace(/\/+$/, '') === normalized;
        });
    }

    dispatchCustomEvent(eventName, data) {
        const event = new CustomEvent(eventName, { detail: data });
        document.dispatchEvent(event);
    }

    async initialize() {
        try {
            await videoDB.init();
            await this.refreshVideoCache();

            // 如果 IndexedDB 为空，尝试从 localStorage 备份恢复
            if (this._videoCache.length === 0) {
                const restored = await this.restoreFromLocalStorage();
                if (restored > 0) {
                    await this.refreshVideoCache();
                    console.log(`从 localStorage 备份恢复了 ${restored} 条数据`);
                }
            }

            await this.updateSearchIndex();

            const savedMode = localStorage.getItem('currentMode');
            if (savedMode && Object.values(MODE).includes(savedMode)) {
                this.currentMode = savedMode;
            }

            // 初始化后立即备份一次
            this.backupToLocalStorage();

            console.log('CoreService 初始化完成');
        } catch (error) {
            console.error('CoreService 初始化失败:', error);
            throw error;
        }
    }

    /**
     * 防抖备份数据到 localStorage
     */
    scheduleBackup() {
        if (this._backupTimer) {
            clearTimeout(this._backupTimer);
        }
        this._backupTimer = setTimeout(() => {
            this.backupToLocalStorage();
            this._backupTimer = null;
        }, 1000);
    }

    /**
     * 监听页面关闭事件，退出前备份一次
     */
    initBackupListener() {
        window.addEventListener('beforeunload', () => {
            this.backupToLocalStorage();
        });
    }

    /**
     * 将当前所有数据备份到 localStorage
     * 超出配额时自动省略 base64 封面
     */
    backupToLocalStorage() {
        try {
            var videos = this._videoCache.length > 0 ? this._videoCache : [];
            if (videos.length === 0) return;

            var items = videos.map(function(v) {
                var obj = v.toObject ? v.toObject() : v;
                // base64 封面可能很大，超限时省略
                if (obj.cover && obj.cover.indexOf('data:') === 0 && obj.cover.length > 500) {
                    obj.cover = '';
                }
                return obj;
            });

            var payload = JSON.stringify({
                version: 1,
                date: Date.now(),
                items: items
            });

            try {
                localStorage.setItem('kb_data_backup', payload);
            } catch (quotaErr) {
                // 配额不足，去除所有封面后重试
                var itemsNoCover = items.map(function(item) {
                    return Object.assign({}, item, { cover: '' });
                });
                try {
                    localStorage.setItem('kb_data_backup', JSON.stringify({
                        version: 1,
                        date: Date.now(),
                        items: itemsNoCover
                    }));
                } catch (e2) {
                    console.warn('localStorage 备份失败（配额不足）:', e2.message);
                }
            }
        } catch (e) {
            console.warn('数据备份失败:', e);
        }
    }

    /**
     * 从 localStorage 备份恢复数据（仅在 IndexedDB 为空时使用）
     */
    async restoreFromLocalStorage() {
        try {
            var raw = localStorage.getItem('kb_data_backup');
            if (!raw) return 0;

            var data = JSON.parse(raw);
            if (!data.items || !data.items.length) return 0;

            // 恢复时用 bulkImport（put，不会覆盖已有数据也不会报错）
            var count = await videoDB.bulkImport(data.items);
            return count;
        } catch (e) {
            console.warn('数据恢复失败:', e);
            return 0;
        }
    }
}

let coreService = null;

function initCoreService() {
    if (!coreService) {
        coreService = new CoreService();
    }
    return coreService;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CoreService, coreService, initCoreService };
}
