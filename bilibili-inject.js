// 在 bilibili.com 页面注入爬取悬浮窗（独立脚本，不依赖知识库页面）

(function () {
    if (window.__KBBiliFloat) {
        window.__KBBiliFloat.mount();
        return;
    }

    const STORAGE = {
        enabled: 'kbFloatEnabled',
        kbUrl: 'kbImportTarget',
        dev: 'kbDevMode'
    };

    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function normalizeUrl(url) {
        if (!url) return '';
        if (url.startsWith('//')) return 'https:' + url;
        return url.replace(/^http:\/\//i, 'https://');
    }

    function decodeHtml(text) {
        if (!text) return '';
        const el = document.createElement('textarea');
        el.innerHTML = text;
        return el.value;
    }

    function cleanTitle(text) {
        if (!text) return '';
        return decodeHtml(text)
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function extractValidCover(img) {
        if (!img) return '';
        var cover = img.getAttribute('data-src')
            || img.getAttribute('data-lazy-src')
            || img.getAttribute('lazy-src')
            || img.src
            || '';
        // 过滤掉 data URI 占位图（懒加载placeholder）
        if (cover && cover.indexOf('data:image') === 0) {
            cover = img.getAttribute('data-src')
                || img.getAttribute('data-lazy-src')
                || img.getAttribute('lazy-src')
                || '';
        }
        return cover;
    }

    function parseJsonBlobs(callback) {
        document.querySelectorAll('script').forEach(function (script) {
            // 1. __INITIAL_STATE__（内联JS赋值）
            var text = script.textContent || '';
            if (text.includes('__INITIAL_STATE__')) {
                var match = text.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;/);
                if (match) {
                    try { callback(JSON.parse(match[1])); } catch (_) { /* ignore */ }
                }
            }

            // 2. __RENDER_DATA__（B站空间页常用，内容可能被URL编码）
            if (script.id === '__RENDER_DATA__') {
                var raw = script.textContent || '';
                try {
                    // 先尝试直接解析
                    callback(JSON.parse(raw));
                } catch (_) {
                    // 失败则尝试URL解码后再解析
                    try {
                        var decoded = decodeURIComponent(raw);
                        callback(JSON.parse(decoded));
                    } catch (e) { /* ignore */ }
                }
            }

            // 3. __NEXT_DATA__（部分B站页面使用）
            if (script.id === '__NEXT_DATA__' || (script.type === 'application/json' && text.includes('__NEXT_DATA__'))) {
                try { callback(JSON.parse(text)); } catch (_) { /* ignore */ }
            }
        });
    }

    function getKbUrl() {
        return localStorage.getItem(STORAGE.kbUrl) || '';
    }

    function setKbUrl(url) {
        if (url) {
            localStorage.setItem(STORAGE.kbUrl, url);
        }
    }

    function isEnabled() {
        return localStorage.getItem(STORAGE.enabled) === 'true';
    }

    function crawlVideosFromDom() {
        const map = new Map();

        function add(bvid, title, cover) {
            if (!bvid) return;
            const url = 'https://www.bilibili.com/video/' + bvid;
            if (map.has(url)) return;
            const cleanT = cleanTitle(title);
            map.set(url, {
                type: 'video',
                title: cleanT || '未命名视频',
                url,
                cover: normalizeUrl(cover || ''),
                desc: cleanT,
                selected: true,
                categoryName: ''
            });
        }

        // 从页面内嵌JSON数据中提取视频
        parseJsonBlobs(function (blob) {
            walkVideoJson(blob, add);
        });

        // 从DOM链接中补充提取视频
        document.querySelectorAll('a[href*="/video/BV"], a[href*="bilibili.com/video/BV"]').forEach((anchor) => {
            const href = anchor.href || anchor.getAttribute('href') || '';
            const match = href.match(/BV[\w]+/);
            if (!match) return;

            const card = anchor.closest(
                '.bili-video-card, .small-item, .video-page-card, .list-item, .video-list, [class*="video-card"], [class*="VideoCard"]'
            ) || anchor.parentElement;

            let title = anchor.getAttribute('title') || anchor.getAttribute('aria-label') || '';
            if (!title && card) {
                const titleEl = card.querySelector(
                    '[class*="title"], .title, .name, h3, .bili-video-card__info--tit, .video-name'
                );
                title = titleEl ? titleEl.textContent : '';
            }
            if (!title) title = anchor.textContent || '';

            let cover = '';
            if (card) {
                cover = extractValidCover(card.querySelector('img'));
            }

            add(match[0], title, cover);
        });

        return Array.from(map.values());
    }

    function walkVideoJson(node, add, depth = 0) {
        if (!node || depth > 14) return;

        if (Array.isArray(node)) {
            node.forEach((item) => walkVideoJson(item, add, depth + 1));
            return;
        }

        if (typeof node === 'object') {
            if (node.bvid && (node.title || node.name)) {
                add(node.bvid, node.title || node.name, node.pic || node.cover || '');
            }
            Object.values(node).forEach((value) => walkVideoJson(value, add, depth + 1));
        }
    }

    function walkArticleJson(node, add, depth = 0) {
        if (!node || depth > 14) return;

        if (Array.isArray(node)) {
            node.forEach((item) => walkArticleJson(item, add, depth + 1));
            return;
        }

        if (typeof node === 'object') {
            if (node.opus_id && (node.content || node.title)) {
                var cover = '';
                if (node.cover) {
                    cover = typeof node.cover === 'string' ? node.cover : (node.cover.url || '');
                }
                var jumpUrl = node.jump_url || '';
                add(String(node.opus_id), node.content || node.title, cover, jumpUrl);
            }
            Object.values(node).forEach((value) => walkArticleJson(value, add, depth + 1));
        }
    }

    function crawlArticlesFromDom() {
        const map = new Map();

        function add(opusId, title, cover, jumpUrl) {
            if (!opusId) return;
            const url = jumpUrl
                ? normalizeUrl(jumpUrl.startsWith('//') ? 'https:' + jumpUrl : jumpUrl)
                : 'https://www.bilibili.com/opus/' + opusId;
            if (map.has(url)) return;
            const cleanT = cleanTitle(title);
            map.set(url, {
                type: 'article',
                title: cleanT || '未命名专栏',
                url,
                cover: normalizeUrl(cover || ''),
                desc: cleanT,
                selected: true,
                categoryName: ''
            });
        }

        // 从页面内嵌JSON数据中提取专栏
        parseJsonBlobs(function (blob) {
            walkArticleJson(blob, add);
        });

        // 从script标签中用正则补充提取
        document.querySelectorAll('script').forEach((script) => {
            const text = script.textContent || '';
            if (!text.includes('opus_id') && !text.includes('opus')) return;

            const regex = /"opus_id"\s*:\s*"(\d+)"[\s\S]{0,600}?"content"\s*:\s*"((?:\\.|[^"\\])*)"/g;
            let match;
            while ((match = regex.exec(text)) !== null) {
                add(match[1], match[2].replace(/\\u0026/g, '&'), '');
            }
        });

        // 从DOM链接中补充提取专栏
        document.querySelectorAll('a[href*="/opus/"], a[href*="/read/cv"]').forEach((anchor) => {
            const href = anchor.href || anchor.getAttribute('href') || '';
            const opusMatch = href.match(/opus\/(\d+)/) || href.match(/read\/cv(\d+)/);
            if (!opusMatch) return;

            const card = anchor.closest('[class*="opus"], [class*="article"], .item, .card') || anchor;
            let title = anchor.getAttribute('title') || '';
            if (!title) {
                const titleEl = card.querySelector('[class*="title"], .title, .content, h3');
                title = titleEl ? titleEl.textContent : '';
            }
            if (!title) title = anchor.textContent || '';

            let cover = extractValidCover(card.querySelector('img'));

            const url = href.startsWith('http') ? href : 'https:' + href;
            add(opusMatch[1], title, cover, url);
        });

        return Array.from(map.values());
    }

    function injectStyles() {
        if (document.getElementById('kb-bili-float-style')) return;

        const style = document.createElement('style');
        style.id = 'kb-bili-float-style';
        style.textContent = `
#kb-bili-float-fab{position:fixed;right:24px;bottom:24px;width:56px;height:56px;border-radius:50%;border:none;background:#00a1d6;color:#fff;font-size:18px;font-weight:700;box-shadow:0 8px 24px rgba(0,161,214,.4);cursor:pointer;z-index:2147483646;display:flex;align-items:center;justify-content:center;font-family:sans-serif}
#kb-bili-float-fab:hover{transform:scale(1.05)}
#kb-bili-float-fab.active{background:#fb7299}
#kb-bili-float-panel{position:fixed;right:24px;bottom:92px;width:min(420px,calc(100vw - 32px));max-height:min(70vh,640px);background:#fff;border:1px solid #e5e7eb;border-radius:16px;box-shadow:0 16px 40px rgba(15,23,42,.2);z-index:2147483647;display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
#kb-bili-float-panel.open{display:flex}
#kb-bili-float-panel *{box-sizing:border-box}
.kb-bili-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #e5e7eb;background:#f8fafc}
.kb-bili-hd h3{margin:0;font-size:16px;color:#111}
.kb-bili-close{border:none;background:transparent;font-size:24px;cursor:pointer;color:#64748b;line-height:1}
.kb-bili-body{padding:14px 16px;overflow-y:auto}
.kb-bili-status{font-size:13px;color:#64748b;margin:0 0 12px;line-height:1.5}
.kb-bili-btns{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
.kb-bili-btn{padding:10px 12px;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600}
.kb-bili-btn-video{background:#00a1d6;color:#fff}
.kb-bili-btn-article{background:#f1f5f9;color:#334155}
.kb-bili-btn-primary{background:#3b82f6;color:#fff}
.kb-bili-btn-secondary{background:#e2e8f0;color:#334155}
.kb-bili-list{display:flex;flex-direction:column;gap:10px;max-height:320px;overflow-y:auto;margin:10px 0}
.kb-bili-item{display:grid;grid-template-columns:auto 72px 1fr;gap:10px;padding:10px;border:1px solid #e5e7eb;border-radius:10px;background:#f8fafc}
.kb-bili-item img,.kb-bili-cover-ph{width:72px;height:48px;object-fit:cover;border-radius:6px;background:#e5e7eb}
.kb-bili-cover-ph{display:flex;align-items:center;justify-content:center;font-size:11px;color:#64748b}
.kb-bili-item input,.kb-bili-item select{width:100%;padding:6px 8px;border:1px solid #e5e7eb;border-radius:6px;font-size:13px;margin-bottom:4px}
.kb-bili-item a{font-size:11px;color:#64748b;word-break:break-all;text-decoration:none}
.kb-bili-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
.kb-bili-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
.kb-bili-url{font-size:12px;color:#94a3b8;word-break:break-all;margin-bottom:8px}
@media(max-width:768px){#kb-bili-float-panel{right:16px;left:16px;width:auto;bottom:88px}#kb-bili-float-fab{right:16px;bottom:16px}}
        `;
        document.head.appendChild(style);
    }

    function createUI() {
        injectStyles();

        if (!document.getElementById('kb-bili-float-fab')) {
            const fab = document.createElement('button');
            fab.id = 'kb-bili-float-fab';
            fab.type = 'button';
            fab.title = '知识库爬取';
            fab.textContent = '爬';
            document.documentElement.appendChild(fab);

            const panel = document.createElement('div');
            panel.id = 'kb-bili-float-panel';
            panel.innerHTML = `
                <div class="kb-bili-hd">
                    <h3>知识库 · B站爬取</h3>
                    <button type="button" class="kb-bili-close" id="kb-bili-close">×</button>
                </div>
                <div class="kb-bili-body">
                    <div class="kb-bili-url" id="kb-bili-page-url"></div>
                    <p class="kb-bili-status" id="kb-bili-status">选择要爬取当前页面的内容类型</p>
                    <div id="kb-bili-step-menu">
                        <div class="kb-bili-btns">
                            <button type="button" class="kb-bili-btn kb-bili-btn-video" id="kb-bili-crawl-video">爬取视频</button>
                            <button type="button" class="kb-bili-btn kb-bili-btn-article" id="kb-bili-crawl-article">爬取专栏</button>
                        </div>
                    </div>
                    <div id="kb-bili-preview" style="display:none">
                        <div class="kb-bili-toolbar">
                            <button type="button" class="kb-bili-btn kb-bili-btn-secondary" id="kb-bili-select-all">全选</button>
                            <button type="button" class="kb-bili-btn kb-bili-btn-secondary" id="kb-bili-select-none">全不选</button>
                        </div>
                        <div class="kb-bili-list" id="kb-bili-list"></div>
                        <div class="kb-bili-actions">
                            <button type="button" class="kb-bili-btn kb-bili-btn-secondary" id="kb-bili-back">返回</button>
                            <button type="button" class="kb-bili-btn kb-bili-btn-primary" id="kb-bili-import">导入知识库</button>
                        </div>
                    </div>
                </div>
            `;
            document.documentElement.appendChild(panel);
        }

        bindEvents();
        updateFabVisibility();
    }

    let pendingItems = [];
    let panelOpen = false;

    function bindEvents() {
        const fab = document.getElementById('kb-bili-float-fab');
        const panel = document.getElementById('kb-bili-float-panel');

        fab.onclick = () => {
            panelOpen = !panelOpen;
            panel.classList.toggle('open', panelOpen);
            fab.classList.toggle('active', panelOpen);
            if (panelOpen) {
                showMenu();
                document.getElementById('kb-bili-page-url').textContent = '当前页面：' + location.href;
            }
        };

        document.getElementById('kb-bili-close').onclick = closePanel;
        document.getElementById('kb-bili-crawl-video').onclick = () => startCrawl('video');
        document.getElementById('kb-bili-crawl-article').onclick = () => startCrawl('article');
        document.getElementById('kb-bili-select-all').onclick = () => setAllSelected(true);
        document.getElementById('kb-bili-select-none').onclick = () => setAllSelected(false);
        document.getElementById('kb-bili-back').onclick = showMenu;
        document.getElementById('kb-bili-import').onclick = confirmImport;
    }

    function closePanel() {
        panelOpen = false;
        document.getElementById('kb-bili-float-panel')?.classList.remove('open');
        document.getElementById('kb-bili-float-fab')?.classList.remove('active');
    }

    function setStatus(text) {
        const el = document.getElementById('kb-bili-status');
        if (el) el.textContent = text;
    }

    function showMenu() {
        document.getElementById('kb-bili-step-menu').style.display = 'block';
        document.getElementById('kb-bili-preview').style.display = 'none';
        setStatus('将爬取当前 B 站页面中可见的视频或专栏链接');
    }

    function showPreview() {
        document.getElementById('kb-bili-step-menu').style.display = 'none';
        document.getElementById('kb-bili-preview').style.display = 'block';
    }

    /**
     * 等待页面内容加载出现
     */
    async function waitForContent() {
        var attempts = 0;
        while (attempts < 30) {
            var hasContent = document.querySelector(
                'a[href*="/video/BV"], a[href*="/opus/"], a[href*="/read/cv"], ' +
                '.bili-video-card, .small-item, .video-page-card, .list-item, [class*="video-card"]'
            );
            if (hasContent) return true;
            await new Promise(function(resolve) { setTimeout(resolve, 1000); });
            attempts++;
        }
        return false;
    }

    /**
     * 自动滚动页面以加载所有内容（懒加载）
     */
    async function autoScroll() {
        var lastHeight = document.body.scrollHeight;
        var noChangeCount = 0;
        var attempts = 0;
        var maxAttempts = 80;

        while (noChangeCount < 5 && attempts < maxAttempts) {
            window.scrollTo(0, document.body.scrollHeight);
            await new Promise(function(resolve) { setTimeout(resolve, 1500); });

            var newHeight = document.body.scrollHeight;
            if (newHeight === lastHeight) {
                noChangeCount++;
            } else {
                noChangeCount = 0;
                lastHeight = newHeight;
            }
            attempts++;
        }

        window.scrollTo(0, 0);
    }

    async function startCrawl(type) {
        setStatus('正在滚动加载所有' + (type === 'video' ? '视频' : '专栏') + '内容...');

        await waitForContent();

        setStatus('正在自动滚动页面以加载全部内容...');
        await autoScroll();

        setStatus(type === 'video' ? '正在解析视频...' : '正在解析专栏...');
        var items = type === 'video' ? crawlVideosFromDom() : crawlArticlesFromDom();

        if (!items.length) {
            setStatus('当前页面未找到' + (type === 'video' ? '视频' : '专栏') + '，请确认页面正确');
            return;
        }

        pendingItems = items;
        renderPreview();
        showPreview();
        setStatus('共找到 ' + items.length + ' 条，可编辑标题后导入知识库');
    }

    /**
     * 检测 URL 中的自动爬取参数并自动执行
     */
    async function checkAutoCrawl() {
        var hash = location.hash || '';
        var match = hash.match(/kbautocrawl=(video|article)/);
        if (!match) return;

        var type = match[1];
        history.replaceState(null, '', location.pathname + location.search);

        panelOpen = true;
        var panel = document.getElementById('kb-bili-float-panel');
        var fab = document.getElementById('kb-bili-float-fab');
        if (panel) panel.classList.add('open');
        if (fab) fab.classList.add('active');

        var urlEl = document.getElementById('kb-bili-page-url');
        if (urlEl) urlEl.textContent = '自动爬取模式 · 当前页面：' + location.href;

        setStatus('将在 1 秒后开始自动爬取' + (type === 'video' ? '视频' : '专栏') + '...');

        await new Promise(function(resolve) { setTimeout(resolve, 1000); });

        await startCrawl(type);
    }

    function setAllSelected(selected) {
        pendingItems.forEach((item) => { item.selected = selected; });
        renderPreview();
    }

    function renderPreview() {
        const list = document.getElementById('kb-bili-list');
        if (!list) return;
        list.innerHTML = '';

        pendingItems.forEach((item, index) => {
            const row = document.createElement('div');
            row.className = 'kb-bili-item';

            const coverHtml = item.cover
                ? `<img src="${escapeHtml(item.cover)}" alt="">`
                : `<div class="kb-bili-cover-ph">${item.type === 'video' ? '视频' : '专栏'}</div>`;

            row.innerHTML = `
                <label><input type="checkbox" ${item.selected ? 'checked' : ''}></label>
                ${coverHtml}
                <div>
                    <input type="text" class="kb-bili-title" value="${escapeHtml(item.title)}" placeholder="标题">
                    <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.url)}</a>
                </div>
            `;

            row.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
                pendingItems[index].selected = e.target.checked;
            });
            row.querySelector('.kb-bili-title').addEventListener('input', (e) => {
                pendingItems[index].title = e.target.value;
            });

            list.appendChild(row);
        });
    }

    function confirmImport() {
        const selected = pendingItems.filter((item) => item.selected && item.title.trim());
        if (!selected.length) {
            alert('请至少选择一条有效内容');
            return;
        }

        let kbUrl = getKbUrl();
        if (!kbUrl) {
            kbUrl = prompt('请输入知识库网站地址（index.html 的完整路径或 URL）', 'file:///');
            if (!kbUrl) return;
            setKbUrl(kbUrl);
        }

        const type = selected[0].type;
        const payload = btoa(unescape(encodeURIComponent(JSON.stringify({
            type,
            items: selected.map((item) => ({
                type: item.type,
                title: item.title.trim(),
                url: item.url,
                cover: item.cover,
                desc: item.desc
            }))
        }))));

        const target = kbUrl.split('#')[0] + '#kbimport=' + encodeURIComponent(payload);
        window.open(target, '_blank');
        setStatus('已打开知识库页面，请在知识库中确认导入');
        alert('已在新标签页打开知识库，请在知识库悬浮窗中确认导入 ' + selected.length + ' 条内容');
    }

    function updateFabVisibility() {
        const fab = document.getElementById('kb-bili-float-fab');
        if (fab) {
            fab.style.display = isEnabled() ? 'flex' : 'none';
        }
    }

    function enable(kbUrl) {
        localStorage.setItem(STORAGE.enabled, 'true');
        localStorage.setItem(STORAGE.dev, 'true');
        if (kbUrl) setKbUrl(kbUrl);
        createUI();
        updateFabVisibility();
        checkAutoCrawl();
        console.log('[知识库] B站悬浮窗已开启');
    }

    function disable() {
        localStorage.setItem(STORAGE.enabled, 'false');
        updateFabVisibility();
        closePanel();
        console.log('[知识库] B站悬浮窗已关闭');
    }

    function mount() {
        if (isEnabled()) {
            createUI();
            checkAutoCrawl();
        }
    }

    window.__KBBiliFloat = {
        enable,
        disable,
        mount,
        crawlVideosFromDom,
        crawlArticlesFromDom,
        isEnabled
    };

  window.KBDevBili = {
        enable(kbUrl) { enable(kbUrl); },
        disable() { disable(); },
        status() {
            console.log({
                floatEnabled: isEnabled(),
                kbUrl: getKbUrl(),
                page: location.href
            });
        }
    };

    if (isEnabled()) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', mount);
        } else {
            mount();
        }
    }

    let lastHref = location.href;
    setInterval(() => {
        if (location.href !== lastHref) {
            lastHref = location.href;
            const urlEl = document.getElementById('kb-bili-page-url');
            if (urlEl && panelOpen) {
                urlEl.textContent = '当前页面：' + location.href;
            }
        }
    }, 800);
})();
