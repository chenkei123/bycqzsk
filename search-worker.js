class SearchWorker {
    constructor() {
        this.index = null;
        this.videos = new Map();
        this.initIndex();
        self.onmessage = this.handleMessage.bind(this);
    }

    initIndex() {
        this.index = new FlexSearch.Document({
            tokenize: 'full',
            resolution: 5,
            depth: 2,
            threshold: 1,
            encode: 'advanced',
            document: {
                id: "id",
                index: [
                    {
                        field: "title",
                        tokenize: "full",
                        resolution: 5,
                        context: true,
                        optimize: true,
                        boost: 2
                    },
                    {
                        field: "desc",
                        tokenize: "full",
                        resolution: 5,
                        context: true,
                        optimize: true,
                        boost: 1
                    },
                    {
                        field: "tags",
                        tokenize: "full",
                        resolution: 5,
                        context: true,
                        optimize: true,
                        boost: 1.5
                    }
                ]
            }
        });

        self.postMessage({
            type: 'INDEX_READY',
            data: { status: 'ready' }
        });
    }

    handleMessage(event) {
        const { type, data, requestId } = event.data;

        try {
            switch (type) {
                case 'UPDATE_INDEX':
                    this.updateIndex(data);
                    break;
                case 'SEARCH':
                    this.performSearch(data, requestId);
                    break;
                case 'GET_INDEX_STATS':
                    this.getIndexStats(requestId);
                    break;
                default:
                    console.warn('未知的消息类型:', type);
            }
        } catch (error) {
            this.sendError(error, requestId);
        }
    }

    updateIndex(videosData) {
        this.index.remove((doc) => true);
        this.videos.clear();

        videosData.forEach(video => {
            const searchDoc = {
                id: video.id,
                title: video.title || '',
                desc: video.desc || '',
                tags: Array.isArray(video.tags) ? video.tags.join(' ') : video.tags || ''
            };

            this.index.add(searchDoc);
            this.videos.set(video.id, video);
        });

        self.postMessage({
            type: 'INDEX_UPDATED',
            data: { videoCount: videosData.length }
        });
    }

    performSearch(searchData, requestId) {
        const { query, options = {} } = searchData;
        const { limit = 100, threshold = 1 } = options;

        if (!query || !query.trim()) {
            const allVideos = Array.from(this.videos.values());
            this.sendResults(allVideos, requestId);
            return;
        }

        try {
            const searchResults = this.index.search(query, {
                limit: limit,
                enrich: true,
                threshold: threshold
            });

            const videoIds = new Set();
            const scoredResults = [];

            searchResults.forEach(resultSet => {
                resultSet.result.forEach(item => {
                    if (!videoIds.has(item.id)) {
                        videoIds.add(item.id);
                        scoredResults.push({
                            id: item.id,
                            score: item.score || 1,
                            field: resultSet.field
                        });
                    }
                });
            });

            scoredResults.sort((a, b) => b.score - a.score);

            const videos = scoredResults
                .slice(0, limit)
                .map(result => this.videos.get(result.id))
                .filter(video => video != null);

            this.sendResults(videos, requestId);
        } catch (error) {
            console.error('搜索执行失败:', error);
            this.sendError(error, requestId);
        }
    }

    getIndexStats(requestId) {
        const stats = {
            videoCount: this.videos.size,
            fields: ['title', 'desc', 'tags'],
            lastUpdate: new Date().toISOString()
        };

        self.postMessage({
            type: 'INDEX_STATS',
            data: stats,
            requestId
        });
    }

    sendResults(videos, requestId) {
        self.postMessage({
            type: 'SEARCH_RESULTS',
            data: videos,
            requestId
        });
    }

    sendError(error, requestId) {
        self.postMessage({
            type: 'ERROR',
            data: { message: error.message, stack: error.stack },
            requestId
        });
    }
}

const searchWorker = new SearchWorker();