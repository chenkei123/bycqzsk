// IO层 - IndexedDB 封装和存储操作

class VideoDatabase {
    constructor() {
        this.dbName = 'VideoKnowledgeDB';
        this.version = 2;
        this.db = null;
        this.isInitialized = false;
    }

    /**
     * 初始化数据库
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => {
                console.error('IndexedDB 初始化失败:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                this.isInitialized = true;
                console.log('IndexedDB 初始化成功');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains('videos')) {
                    // 首次创建：创建对象存储和索引
                    const store = db.createObjectStore('videos', {
                        keyPath: 'id',
                        autoIncrement: false
                    });

                    store.createIndex('title', 'title', { unique: false });
                    store.createIndex('tags', 'tags', { multiEntry: true });
                    store.createIndex('addDate', 'addDate', { unique: false });
                    store.createIndex('updateDate', 'updateDate', { unique: false });

                    console.log('数据库结构创建完成');
                } else {
                    // 升级时保留已有数据，仅补充缺失的索引
                    const store = event.target.transaction.objectStore('videos');
                    if (!store.indexNames.contains('title')) {
                        store.createIndex('title', 'title', { unique: false });
                    }
                    if (!store.indexNames.contains('tags')) {
                        store.createIndex('tags', 'tags', { multiEntry: true });
                    }
                    if (!store.indexNames.contains('addDate')) {
                        store.createIndex('addDate', 'addDate', { unique: false });
                    }
                    if (!store.indexNames.contains('updateDate')) {
                        store.createIndex('updateDate', 'updateDate', { unique: false });
                    }

                    console.log('数据库结构升级完成（数据已保留）');
                }

                // 版本2：新增 likes 存储（点赞数据）
                if (!db.objectStoreNames.contains('likes')) {
                    db.createObjectStore('likes', { keyPath: 'id' });
                    console.log('likes 存储创建完成');
                }
            };
        });
    }

    /**
     * 获取数据库连接
     */
    async getDB() {
        if (!this.isInitialized) {
            await this.init();
        }
        return this.db;
    }

    /**
     * 添加视频
     */
    async addVideo(videoData) {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['videos'], 'readwrite');
            const store = transaction.objectStore('videos');
            
            const content = videoData.type === 'article' ? new ArticleInfo(videoData) : new VideoInfo(videoData);
            const request = store.add(content.toObject());

            request.onsuccess = () => {
                console.log('内容添加成功:', content.id);
                resolve(content);
            };

            request.onerror = () => {
                console.error('内容添加失败:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 更新视频
     */
    async updateVideo(videoId, updates) {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['videos'], 'readwrite');
            const store = transaction.objectStore('videos');

            // 先获取现有数据
            const getRequest = store.get(videoId);
            
            getRequest.onsuccess = () => {
                const existingVideo = getRequest.result;
                if (!existingVideo) {
                    reject(new Error('视频不存在'));
                    return;
                }

                // 合并更新
                const updatedContent = {
                    ...existingVideo,
                    ...updates,
                    updateDate: Date.now()
                };

                const putRequest = store.put(updatedContent);
                
                putRequest.onsuccess = () => {
                    console.log('内容更新成功:', videoId);
                    resolve(ContentInfo.fromObject(updatedContent));
                };

                putRequest.onerror = () => {
                    reject(putRequest.error);
                };
            };

            getRequest.onerror = () => {
                reject(getRequest.error);
            };
        });
    }

    /**
     * 删除视频
     */
    async deleteVideo(videoId) {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['videos'], 'readwrite');
            const store = transaction.objectStore('videos');
            const request = store.delete(videoId);

            request.onsuccess = () => {
                console.log('视频删除成功:', videoId);
                resolve(videoId);
            };

            request.onerror = () => {
                console.error('视频删除失败:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 获取所有视频
     */
    async getAllVideos() {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['videos'], 'readonly');
            const store = transaction.objectStore('videos');
            const request = store.getAll();

            request.onsuccess = () => {
                const contents = request.result.map(item => ContentInfo.fromObject(item));
                resolve(contents);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    /**
     * 按时间倒序查询视频（用于时间线模式）
     */
    async queryVideosByDate(offset = 0, limit = PAGINATION_CONFIG.timeline.pageSize) {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['videos'], 'readonly');
            const store = transaction.objectStore('videos');
            const index = store.index('addDate');
            
            const videos = [];
            let count = 0;
            let hasSkipped = false;

            // 使用游标倒序遍历（从最新到最旧）
            const request = index.openCursor(null, 'prev');

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                
                if (!cursor) {
                    resolve(videos);
                    return;
                }

                // 跳过指定数量的记录
                if (!hasSkipped && offset > 0) {
                    cursor.advance(offset);
                    hasSkipped = true;
                    return;
                }

                // 收集数据直到达到限制
                if (count < limit) {
                    videos.push(VideoInfo.fromObject(cursor.value));
                    count++;
                    cursor.continue();
                } else {
                    resolve(videos);
                }
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    /**
     * 按标签查询视频
     */
    async queryVideosByTag(tag, offset = 0, limit = 50) {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['videos'], 'readonly');
            const store = transaction.objectStore('videos');
            const index = store.index('tags');
            
            const videos = [];
            let count = 0;
            let hasSkipped = false;

            const request = index.openCursor(IDBKeyRange.only(tag));

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                
                if (!cursor) {
                    resolve(videos);
                    return;
                }

                // 跳过指定数量的记录
                if (!hasSkipped && offset > 0) {
                    cursor.advance(offset);
                    hasSkipped = true;
                    return;
                }

                // 收集数据直到达到限制
                if (count < limit) {
                    videos.push(VideoInfo.fromObject(cursor.value));
                    count++;
                    cursor.continue();
                } else {
                    resolve(videos);
                }
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    /**
     * 搜索视频（基础文本搜索，高性能搜索在worker中实现）
     */
    async searchVideos(query, limit = 50) {
        if (!query.trim()) {
            return this.getAllVideos();
        }

        const allVideos = await this.getAllVideos();
        const searchTerm = query.toLowerCase();
        
        return allVideos.filter(video => {
            return video.title.toLowerCase().includes(searchTerm) ||
                   video.desc.toLowerCase().includes(searchTerm) ||
                   video.tags.some(tag => tag.toLowerCase().includes(searchTerm));
        }).slice(0, limit);
    }

    /**
     * 获取所有标签及其统计
     */
    async getAllTagsWithStats(field = 'tags') {
        const allVideos = await this.getAllVideos();
        const tagStats = {};

        allVideos.forEach(video => {
            const tags = Array.isArray(video[field]) ? video[field] : [];
            tags.forEach(tag => {
                if (!tagStats[tag]) {
                    tagStats[tag] = { count: 0, videos: [] };
                }
                tagStats[tag].count++;
                tagStats[tag].videos.push(video.id);
            });
        });

        return tagStats;
    }

    /**
     * 保存点赞记录到 IndexedDB
     */
    async putLike(like) {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['likes'], 'readwrite');
            const store = transaction.objectStore('likes');
            const request = store.put(like);
            request.onsuccess = () => {
                resolve(like);
            };
            request.onerror = () => {
                console.error('保存点赞记录失败:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 获取单条点赞记录
     */
    async getLike(id) {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['likes'], 'readonly');
            const store = transaction.objectStore('likes');
            const request = store.get(id);
            request.onsuccess = () => {
                resolve(request.result || null);
            };
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    /**
     * 批量获取点赞记录
     */
    async getLikes(idArray) {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['likes'], 'readonly');
            const store = transaction.objectStore('likes');
            const results = {};
            let remaining = idArray.length;
            if (remaining === 0) { resolve(results); return; }
            idArray.forEach(id => {
                const request = store.get(id);
                request.onsuccess = () => {
                    if (request.result) results[id] = request.result;
                    remaining--;
                    if (remaining === 0) resolve(results);
                };
                request.onerror = () => {
                    remaining--;
                    if (remaining === 0) resolve(results);
                };
            });
        });
    }

    /**
     * 按标签分组获取视频（用于知识图谱模式）
     */
    async queryVideosGroupedByTags() {
        const tagStats = await this.getAllTagsWithStats();
        const groupedVideos = {};

        for (const [tag, stats] of Object.entries(tagStats)) {
            // 获取该标签下的所有视频
            const videos = await this.queryVideosByTag(tag, 0, 100);
            groupedVideos[tag] = {
                tag,
                count: stats.count,
                videos: videos
            };
        }

        return groupedVideos;
    }

    /**
     * 获取视频数量统计
     */
    async getVideoStats() {
        const allVideos = await this.getAllVideos();
        const tagStats = await this.getAllTagsWithStats();
        
        return {
            totalVideos: allVideos.length,
            totalTags: Object.keys(tagStats).length,
            latestVideo: allVideos.length > 0 ? 
                allVideos.reduce((latest, video) => 
                    video.addDate > latest.addDate ? video : latest
                ) : null
        };
    }

    /**
     * 导出所有数据为JSON
     */
    async exportData() {
        const allVideos = await this.getAllVideos();
        return {
            version: this.version,
            exportDate: new Date().toISOString(),
            videos: allVideos.map(video => video.toObject())
        };
    }

    /**
     * 从JSON导入数据
     */
    async importData(data) {
        if (!data.videos || !Array.isArray(data.videos)) {
            throw new Error('无效的数据格式');
        }

        const db = await this.getDB();
        const transaction = db.transaction(['videos'], 'readwrite');
        const store = transaction.objectStore('videos');

        // 清空现有数据
        await new Promise((resolve, reject) => {
            const clearRequest = store.clear();
            clearRequest.onsuccess = () => resolve();
            clearRequest.onerror = () => reject(clearRequest.error);
        });

        // 导入新数据
        const importPromises = data.videos.map(videoData => {
            return new Promise((resolve, reject) => {
                const video = new VideoInfo(videoData);
                const request = store.add(video.toObject());
                
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        });

        await Promise.all(importPromises);
        console.log(`成功导入 ${importPromises.length} 个视频`);
    }

    /**
     * 批量导入数据（使用 put，不清空已有数据，适合备份恢复）
     */
    async bulkImport(items) {
        if (!items || !Array.isArray(items)) {
            return 0;
        }

        const db = await this.getDB();
        let successCount = 0;

        for (const item of items) {
            try {
                await new Promise((resolve) => {
                    const transaction = db.transaction(['videos'], 'readwrite');
                    const store = transaction.objectStore('videos');
                    const content = item.type === 'article'
                        ? new ArticleInfo(item)
                        : new VideoInfo(item);
                    const request = store.put(content.toObject());

                    request.onsuccess = () => {
                        successCount++;
                        resolve();
                    };
                    request.onerror = () => resolve();
                });
            } catch (e) {
                // 忽略单条错误
            }
        }

        console.log(`批量导入完成，共 ${successCount} 条`);
        return successCount;
    }

    /**
     * 清除所有数据
     */
    async clearAllData() {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['videos'], 'readwrite');
            const store = transaction.objectStore('videos');
            const request = store.clear();

            request.onsuccess = () => {
                console.log('所有数据已清除');
                resolve();
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    /**
     * 保存关系图谱的边数据（手动添加的关系）到 IndexedDB
     */
    async saveRelationsEdges(edges) {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['videos'], 'readwrite');
            const store = transaction.objectStore('videos');

            // 使用固定的 id 存储关系数据
            const data = {
                id: '__kb_relations_edges__',
                _isSystem: true,
                edges: edges || [],
                savedAt: Date.now()
            };

            const request = store.put(data);
            request.onsuccess = () => {
                console.log('关系数据保存到 IndexedDB 成功');
                resolve();
            };
            request.onerror = () => {
                console.error('关系数据保存到 IndexedDB 失败:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 从 IndexedDB 加载关系图谱的边数据
     */
    async loadRelationsEdges() {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['videos'], 'readonly');
            const store = transaction.objectStore('videos');
            const request = store.get('__kb_relations_edges__');

            request.onsuccess = () => {
                const result = request.result;
                if (result && result.edges) {
                    resolve(result.edges);
                } else {
                    resolve([]);
                }
            };
            request.onerror = () => {
                console.error('从 IndexedDB 加载关系数据失败:', request.error);
                reject(request.error);
            };
        });
    }
}

let videoDB = null;

/**
 * 初始化 videoDB（创建实例 + 连接 IndexedDB）
 * 返回 Promise<VideoDatabase>，确保数据库连接就绪
 */
function initVideoDB() {
    if (!videoDB) {
        videoDB = new VideoDatabase();
    }
    if (videoDB.isInitialized) {
        return Promise.resolve(videoDB);
    }
    return videoDB.init().then(function () {
        return videoDB;
    });
}

// 脚本加载时自动创建实例并初始化数据库连接
videoDB = new VideoDatabase();
videoDB.init().catch(function (err) {
    console.error('videoDB 自动初始化失败:', err);
});

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VideoDatabase, videoDB, initVideoDB };
}