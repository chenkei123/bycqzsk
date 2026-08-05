// B站内容爬取模块

class BilibiliCrawler {
    constructor() {
        this.videoSpaceUrl = 'https://space.bilibili.com/1939904826/upload/video';
        this.articleSpaceUrl = 'https://space.bilibili.com/1939904826/upload/opus';
        this.crawlInterval = 24 * 60 * 60 * 1000;
        this.crawlTimer = null;
        this.crawledItems = {};
        this.coreService = null;
        this.isCrawling = false;
        this.lastCrawlResult = { newVideos: 0, newArticles: 0 };
        this.defaultHeaders = {
            Accept: 'application/json, text/plain, */*',
            Referer: 'https://space.bilibili.com/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        };
    }

    async init(coreService) {
        this.coreService = coreService;
        this.loadApiUrls();
        this.loadCrawledItems();
        await this.syncCrawledItemsFromDatabase();
        this.startCrawlTimer();
    }

    loadApiUrls() {
        const savedVideoUrl = localStorage.getItem('videoApiUrl');
        const savedArticleUrl = localStorage.getItem('articleApiUrl');

        if (savedVideoUrl) {
            this.videoSpaceUrl = savedVideoUrl;
        }

        if (savedArticleUrl) {
            this.articleSpaceUrl = savedArticleUrl;
        }
    }

    async updateApiUrls(videoUrl, articleUrl, options = { crawl: true, forcePageRefresh: false }) {
        this.videoSpaceUrl = videoUrl;
        this.articleSpaceUrl = articleUrl;
        localStorage.setItem('videoApiUrl', videoUrl);
        localStorage.setItem('articleApiUrl', articleUrl);

        if (options.crawl === false) {
            return { newVideos: 0, newArticles: 0 };
        }

        return this.crawlAll({
            forcePageRefresh: options.forcePageRefresh === true
        });
    }

    startCrawlTimer() {
        if (this.crawlTimer) {
            clearTimeout(this.crawlTimer);
            this.crawlTimer = null;
        }

        const lastCrawl = parseInt(localStorage.getItem('bilibiliLastCrawlTime') || '0', 10);
        const elapsed = Date.now() - lastCrawl;
        const delay = lastCrawl === 0 || elapsed >= this.crawlInterval
            ? 0
            : this.crawlInterval - elapsed;

        this.scheduleNextCrawl(delay);
    }

    scheduleNextCrawl(delay) {
        if (this.crawlTimer) {
            clearTimeout(this.crawlTimer);
        }

        this.crawlTimer = setTimeout(async () => {
            await this.crawlAll();
            this.scheduleNextCrawl(this.crawlInterval);
        }, delay);
    }

    async crawlAll(options = {}) {
        if (this.isCrawling) {
            return this.lastCrawlResult;
        }

        this.isCrawling = true;
        const forcePageRefresh = options.forcePageRefresh === true;

        try {
            console.log('开始爬取B站内容...', forcePageRefresh ? '(手动刷新空间页)' : '');
            const newVideos = await this.crawlVideos(forcePageRefresh);
            const newArticles = await this.crawlArticles(forcePageRefresh);
            this.saveCrawledItems();
            localStorage.setItem('bilibiliLastCrawlTime', Date.now().toString());

            this.lastCrawlResult = { newVideos, newArticles };
            console.log(`B站内容爬取完成，新增 ${newVideos} 个视频、${newArticles} 篇专栏`);
            return this.lastCrawlResult;
        } catch (error) {
            console.error('爬取B站内容失败:', error);
            return { newVideos: 0, newArticles: 0, error: error.message };
        } finally {
            this.isCrawling = false;
        }
    }

    async crawlVideos(forcePageRefresh = false) {
        let newCount = 0;

        try {
            const videos = await this.fetchVideos(forcePageRefresh);
            for (const video of videos) {
                if (!this.isItemCrawled(video.url) && !(await this.isUrlInDatabase(video.url))) {
                    await this.addVideo(video);
                    this.markItemAsCrawled(video.url);
                    newCount++;
                }
            }
        } catch (error) {
            console.error('爬取视频失败:', error);
        }

        return newCount;
    }

    async crawlArticles(forcePageRefresh = false) {
        let newCount = 0;

        try {
            const articles = await this.fetchArticles(forcePageRefresh);
            for (const article of articles) {
                if (!this.isItemCrawled(article.url) && !(await this.isUrlInDatabase(article.url))) {
                    await this.addArticle(article);
                    this.markItemAsCrawled(article.url);
                    newCount++;
                }
            }
        } catch (error) {
            console.error('爬取专栏失败:', error);
        }

        return newCount;
    }

    extractUserId(url) {
        try {
            const match = url.match(/space\.bilibili\.com\/(\d+)/);
            return match ? match[1] : null;
        } catch (error) {
            console.error('提取UP主ID失败:', error);
            return null;
        }
    }

    normalizeBilibiliUrl(url) {
        if (!url) return '';
        if (url.startsWith('//')) {
            return `https:${url}`;
        }
        return url;
    }

    normalizeCoverUrl(url) {
        if (!url) return '';
        const normalized = url.startsWith('//') ? `https:${url}` : url;
        return normalized.replace(/^http:\/\//i, 'https://');
    }

    normalizeContentUrl(url) {
        return this.normalizeBilibiliUrl(url).replace(/\/+$/, '');
    }

    decodeHtmlEntities(text) {
        if (!text) return '';
        const textarea = typeof document !== 'undefined' ? document.createElement('textarea') : null;
        if (textarea) {
            textarea.innerHTML = text;
            return textarea.value;
        }
        return text
            .replace(/\\u0026/g, '&')
            .replace(/\\"/g, '"')
            .replace(/\\n/g, '\n')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"');
    }

    async fetchText(url, timeoutMs = 12000) {
        const attempts = [
            () => this.directFetchText(url, timeoutMs),
            () => this.proxyFetchText(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, timeoutMs, true),
            () => this.proxyFetchText(`https://corsproxy.io/?${encodeURIComponent(url)}`, timeoutMs, false),
            () => this.proxyFetchText(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, timeoutMs, false)
        ];

        for (const attempt of attempts) {
            try {
                const text = await attempt();
                if (text && text.trim() && !this.isBlockedResponse(text)) {
                    return text;
                }
            } catch (error) {
                console.debug(`请求失败(${url}): ${error.message}`);
            }
        }

        console.warn('所有网络请求方式均失败:', url);
        return null;
    }

    async fetchJson(url, timeoutMs = 12000) {
        const text = await this.fetchText(url, timeoutMs);
        if (!text) {
            return null;
        }

        try {
            return this.parseJsonResponse(text);
        } catch (error) {
            console.debug(`JSON解析失败(${url}): ${error.message}`);
            return null;
        }
    }

    async directFetchText(url, timeoutMs) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(url, {
            signal: controller.signal,
            mode: 'cors',
            headers: this.defaultHeaders
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return response.text();
    }

    async proxyFetchText(proxyUrl, timeoutMs, allOriginsWrapped) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(proxyUrl, {
            signal: controller.signal,
            headers: { Accept: '*/*' }
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`Proxy HTTP ${response.status}`);
        }

        if (allOriginsWrapped) {
            const wrapper = await response.json();
            return wrapper.contents || '';
        }

        return response.text();
    }

    isBlockedResponse(text) {
        const sample = text.slice(0, 2000).toLowerCase();
        return sample.includes('验证码') ||
            sample.includes('security.bilibili.com') ||
            sample.includes('412') && sample.includes('security control policy') ||
            sample.includes('请求过于频繁');
    }

    parseJsonResponse(text) {
        const trimmed = (text || '').trim();
        if (!trimmed) {
            throw new Error('空响应');
        }

        if (trimmed.startsWith('<')) {
            throw new Error('响应不是有效的JSON');
        }

        return JSON.parse(trimmed);
    }

    async fetchVideos(forcePageRefresh = false) {
        const userId = this.extractUserId(this.videoSpaceUrl);
        if (!userId) {
            console.warn('无法从链接提取UP主ID，跳过视频爬取');
            return [];
        }

        if (forcePageRefresh) {
            const pageVideos = await this.fetchVideosFromSpacePage(this.videoSpaceUrl);
            if (pageVideos.length > 0) {
                console.log(`从视频空间页解析到 ${pageVideos.length} 个视频`);
                return pageVideos;
            }
        }

        const apiVideos = await this.fetchVideosFromApi(userId);
        if (apiVideos.length > 0) {
            return apiVideos;
        }

        if (!forcePageRefresh) {
            const pageVideos = await this.fetchVideosFromSpacePage(this.videoSpaceUrl);
            if (pageVideos.length > 0) {
                console.log(`从视频空间页解析到 ${pageVideos.length} 个视频`);
                return pageVideos;
            }
        }

        console.log('成功获取 0 个视频');
        return [];
    }

    async fetchArticles(forcePageRefresh = false) {
        const userId = this.extractUserId(this.articleSpaceUrl);
        if (!userId) {
            console.warn('无法从链接提取UP主ID，跳过专栏爬取');
            return [];
        }

        if (forcePageRefresh) {
            const pageArticles = await this.fetchArticlesFromSpacePage(this.articleSpaceUrl);
            if (pageArticles.length > 0) {
                console.log(`从专栏空间页解析到 ${pageArticles.length} 篇专栏`);
                return pageArticles;
            }
        }

        const apiArticles = await this.fetchArticlesFromApi(userId);
        if (apiArticles.length > 0) {
            return apiArticles;
        }

        if (!forcePageRefresh) {
            const pageArticles = await this.fetchArticlesFromSpacePage(this.articleSpaceUrl);
            if (pageArticles.length > 0) {
                console.log(`从专栏空间页解析到 ${pageArticles.length} 篇专栏`);
                return pageArticles;
            }
        }

        console.log('成功获取 0 篇专栏');
        return [];
    }

    async fetchVideosFromSpacePage(pageUrl) {
        const cacheBustedUrl = `${pageUrl}${pageUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`;
        const html = await this.fetchText(cacheBustedUrl);
        if (!html) {
            return [];
        }
        return this.parseVideosFromHtml(html);
    }

    async fetchArticlesFromSpacePage(pageUrl) {
        const cacheBustedUrl = `${pageUrl}${pageUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`;
        const html = await this.fetchText(cacheBustedUrl);
        if (!html) {
            return [];
        }
        return this.parseArticlesFromHtml(html);
    }

    /**
     * 从任意B站页面URL爬取内容（供悬浮窗使用）
     */
    async crawlFromPageUrl(pageUrl, type) {
        if (!pageUrl) {
            return [];
        }

        let items = [];
        if (type === 'video') {
            items = await this.fetchVideosFromSpacePage(pageUrl);
            if (items.length === 0) {
                const userId = this.extractUserId(pageUrl);
                if (userId) {
                    items = await this.fetchVideosFromApi(userId);
                }
            }
        } else {
            items = await this.fetchArticlesFromSpacePage(pageUrl);
            if (items.length === 0) {
                const userId = this.extractUserId(pageUrl);
                if (userId) {
                    items = await this.fetchArticlesFromApi(userId);
                }
            }
        }

        return items.map(item => ({
            ...item,
            type: type === 'video' ? 'video' : 'article',
            selected: true,
            categoryId: ''
        }));
    }

    /**
     * 解析已抓取的数据包（书签脚本 / 跨页导入）
     */
    normalizeImportedItems(rawItems, defaultType) {
        const map = new Map();

        (rawItems || []).forEach((item) => {
            const type = item.type === 'article' ? 'article' : (defaultType || 'video');
            let url = this.normalizeContentUrl(item.url || '');
            let title = (item.title || item.name || item.content || '').trim();
            let cover = this.normalizeCoverUrl(item.cover || item.pic || '');

            if (!url) {
                return;
            }

            if (type === 'video') {
                const bvidMatch = url.match(/BV[\w]+/);
                if (bvidMatch) {
                    url = this.normalizeContentUrl(`https://www.bilibili.com/video/${bvidMatch[0]}`);
                }
            } else {
                const opusMatch = url.match(/opus\/(\d+)/) || url.match(/read\/cv(\d+)/);
                if (opusMatch) {
                    url = this.normalizeContentUrl(`https://www.bilibili.com/opus/${opusMatch[1]}`);
                }
            }

            if (!title) {
                title = type === 'video' ? '未命名视频' : '未命名专栏';
            }

            map.set(url, {
                type,
                title,
                url,
                cover,
                desc: item.desc || title,
                selected: true,
                categoryId: ''
            });
        });

        return Array.from(map.values());
    }

    parseVideosFromHtml(html) {
        const videos = new Map();

        this.extractJsonBlobs(html).forEach((blob) => {
            this.walkForVideos(blob, videos);
        });

        const regex = /"bvid"\s*:\s*"(BV[^"]+)"[\s\S]{0,800}?"title"\s*:\s*"((?:\\.|[^"\\])*)"[\s\S]{0,800}?"pic"\s*:\s*"((?:\\.|[^"\\])*)"/g;
        let match;
        while ((match = regex.exec(html)) !== null) {
            this.addVideoCandidate(videos, match[1], match[2], match[3]);
        }

        return Array.from(videos.values());
    }

    parseArticlesFromHtml(html) {
        const articles = new Map();

        this.extractJsonBlobs(html).forEach((blob) => {
            this.walkForArticles(blob, articles);
        });

        const regex = /"opus_id"\s*:\s*"(\d+)"[\s\S]{0,500}?"content"\s*:\s*"((?:\\.|[^"\\])*)"/g;
        let match;
        while ((match = regex.exec(html)) !== null) {
            this.addArticleCandidate(articles, match[1], match[2], '');
        }

        const jumpRegex = /"jump_url"\s*:\s*"(\/\/www\.bilibili\.com\/opus\/(\d+))"[\s\S]{0,300}?"content"\s*:\s*"((?:\\.|[^"\\])*)"/g;
        while ((match = jumpRegex.exec(html)) !== null) {
            this.addArticleCandidate(articles, match[2], match[3], '');
        }

        return Array.from(articles.values());
    }

    extractJsonBlobs(html) {
        const blobs = [];

        const renderDataMatch = html.match(/<script id="__RENDER_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
        if (renderDataMatch) {
            try {
                blobs.push(JSON.parse(renderDataMatch[1]));
            } catch (error) {
                // __RENDER_DATA__ 内容可能被 URL 编码，尝试解码后再解析
                try {
                    const decoded = decodeURIComponent(renderDataMatch[1]);
                    blobs.push(JSON.parse(decoded));
                } catch (e) {
                    console.debug('解析 __RENDER_DATA__ 失败:', e.message);
                }
            }
        }

        const initialStateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/);
        if (initialStateMatch) {
            try {
                blobs.push(JSON.parse(initialStateMatch[1]));
            } catch (error) {
                console.debug('解析 __INITIAL_STATE__ 失败:', error.message);
            }
        }

        const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
        if (nextDataMatch) {
            try {
                blobs.push(JSON.parse(nextDataMatch[1]));
            } catch (error) {
                console.debug('解析 __NEXT_DATA__ 失败:', error.message);
            }
        }

        return blobs;
    }

    walkForVideos(node, videos, depth = 0) {
        if (!node || depth > 12) {
            return;
        }

        if (Array.isArray(node)) {
            node.forEach(item => this.walkForVideos(item, videos, depth + 1));
            return;
        }

        if (typeof node === 'object') {
            if (node.bvid && (node.title || node.name)) {
                this.addVideoCandidate(videos, node.bvid, node.title || node.name, node.pic || node.cover || '');
            }

            Object.values(node).forEach(value => this.walkForVideos(value, videos, depth + 1));
        }
    }

    walkForArticles(node, articles, depth = 0) {
        if (!node || depth > 12) {
            return;
        }

        if (Array.isArray(node)) {
            node.forEach(item => this.walkForArticles(item, articles, depth + 1));
            return;
        }

        if (typeof node === 'object') {
            if (node.opus_id && (node.content || node.title)) {
                const cover = node.cover && node.cover.url ? node.cover.url : (typeof node.cover === 'string' ? node.cover : '');
                this.addArticleCandidate(articles, node.opus_id, node.content || node.title, cover);
            }

            Object.values(node).forEach(value => this.walkForArticles(value, articles, depth + 1));
        }
    }

    addVideoCandidate(map, bvid, title, pic) {
        if (!bvid || !title) {
            return;
        }

        const cleanTitle = this.decodeHtmlEntities(title).replace(/<[^>]+>/g, '').trim();
        if (!cleanTitle) {
            return;
        }

        map.set(bvid, {
            title: cleanTitle,
            url: this.normalizeContentUrl(`https://www.bilibili.com/video/${bvid}`),
            cover: this.normalizeCoverUrl(this.decodeHtmlEntities(pic)),
            desc: cleanTitle
        });
    }

    addArticleCandidate(map, opusId, content, cover) {
        if (!opusId || !content) {
            return;
        }

        const cleanTitle = this.decodeHtmlEntities(content).replace(/<[^>]+>/g, '').trim();
        if (!cleanTitle) {
            return;
        }

        map.set(String(opusId), {
            title: cleanTitle,
            url: this.normalizeContentUrl(`https://www.bilibili.com/opus/${opusId}`),
            cover: this.normalizeCoverUrl(this.decodeHtmlEntities(cover)),
            desc: cleanTitle
        });
    }

    async fetchVideosFromApi(userId) {
        let allVideos = [];
        let page = 1;
        let hasMore = true;

        while (hasMore && page <= 200) {
            const apiUrl = `https://api.bilibili.com/x/space/arc/search?mid=${userId}&ps=50&tid=0&pn=${page}&keyword=&order=pubdate`;
            const data = await this.fetchJson(apiUrl);

            if (data && data.code === 0 && data.data && data.data.list && data.data.list.vlist) {
                const videos = data.data.list.vlist.map(video => ({
                    title: video.title,
                    url: this.normalizeContentUrl(`https://www.bilibili.com/video/${video.bvid}`),
                    cover: this.normalizeCoverUrl(video.pic),
                    desc: video.description || ''
                }));

                allVideos = allVideos.concat(videos);
                hasMore = videos.length === 50;
                page++;
                if (hasMore) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            } else {
                hasMore = false;
            }
        }

        console.log(`成功获取 ${allVideos.length} 个视频`);
        return allVideos;
    }

    async fetchArticlesFromApi(userId) {
        let allArticles = [];
        let offset = '';
        let hasMore = true;
        let pageCount = 0;

        while (hasMore && pageCount < 200) {
            let apiUrl = `https://api.bilibili.com/x/polymer/web-dynamic/v1/opus/feed/space?host_mid=${userId}&type=article`;
            if (offset) {
                apiUrl += `&offset=${encodeURIComponent(offset)}`;
            }

            const data = await this.fetchJson(apiUrl);

            if (data && data.code === 0 && data.data && Array.isArray(data.data.items)) {
                const articles = data.data.items.map(item => ({
                    title: (item.content || '未命名专栏').trim(),
                    url: this.normalizeContentUrl(
                        item.jump_url || `https://www.bilibili.com/opus/${item.opus_id}`
                    ),
                    cover: item.cover && item.cover.url ? this.normalizeCoverUrl(item.cover.url) : '',
                    desc: item.content || ''
                }));

                allArticles = allArticles.concat(articles);
                hasMore = data.data.has_more === true && articles.length > 0;
                offset = data.data.offset || '';
                pageCount++;
                if (hasMore) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            } else {
                hasMore = false;
            }
        }

        console.log(`成功获取 ${allArticles.length} 篇专栏`);
        return allArticles;
    }

    async addVideo(video) {
        if (this.coreService) {
            await this.coreService.addVideo({
                type: 'video',
                title: video.title,
                url: video.url,
                cover: video.cover,
                desc: video.desc,
                tags: []
            });
        }
    }

    async addArticle(article) {
        if (this.coreService) {
            await this.coreService.addVideo({
                type: 'article',
                title: article.title,
                url: article.url,
                cover: article.cover,
                desc: article.desc,
                tags: []
            });
        }
    }

    async isUrlInDatabase(url) {
        if (typeof videoDB === 'undefined') {
            return false;
        }

        const normalizedUrl = this.normalizeContentUrl(url);
        const allItems = await videoDB.getAllVideos();
        return allItems.some(item => this.normalizeContentUrl(item.url) === normalizedUrl);
    }

    async syncCrawledItemsFromDatabase() {
        if (typeof videoDB === 'undefined') {
            return;
        }

        try {
            const allItems = await videoDB.getAllVideos();
            allItems.forEach(item => {
                if (item.url) {
                    this.crawledItems[this.normalizeContentUrl(item.url)] = item.addDate || Date.now();
                }
            });
            this.saveCrawledItems();
        } catch (error) {
            console.error('同步已爬取记录失败:', error);
        }
    }

    isItemCrawled(url) {
        return this.crawledItems[this.normalizeContentUrl(url)] !== undefined;
    }

    markItemAsCrawled(url) {
        this.crawledItems[this.normalizeContentUrl(url)] = Date.now();
    }

    saveCrawledItems() {
        localStorage.setItem('bilibiliCrawledItems', JSON.stringify(this.crawledItems));
    }

    loadCrawledItems() {
        const saved = localStorage.getItem('bilibiliCrawledItems');
        if (saved) {
            try {
                this.crawledItems = JSON.parse(saved);
            } catch (error) {
                console.error('加载已爬取项目失败:', error);
                this.crawledItems = {};
            }
        }
    }

    getNextCrawlTime() {
        const lastCrawl = parseInt(localStorage.getItem('bilibiliLastCrawlTime') || '0', 10);
        if (!lastCrawl) {
            return null;
        }
        return new Date(lastCrawl + this.crawlInterval);
    }

    stop() {
        if (this.crawlTimer) {
            clearTimeout(this.crawlTimer);
            this.crawlTimer = null;
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = BilibiliCrawler;
}
