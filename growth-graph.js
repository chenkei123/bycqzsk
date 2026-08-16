/* ============================================================
 * 生长线 - 关系图谱编辑器
 * 模块1-10: 类型定义 / 状态管理 / 摄像机 / 拓扑排序 /
 *           渲染引擎 / 交互管理 / 生长动画 / 编辑面板 /
 *           顶部控制栏 / 主应用壳层
 * 全部基于原生 Canvas 2D API 自研渲染管线
 * ============================================================ */

(function () {
    'use strict';

    /* ========================================================
     * 模块1: 类型定义与常量
     * ======================================================== */

    // 预设 8 种节点颜色
    var NODE_COLOR_PRESETS = [
        '#3b82f6', '#22c55e', '#f59e0b', '#ef4444',
        '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'
    ];

    // 预设 8 种连线颜色
    var EDGE_COLOR_PRESETS = [
        '#6366f1', '#10b981', '#f97316', '#dc2626',
        '#a855f7', '#db2777', '#0891b2', '#65a30d'
    ];

    // 默认节点尺寸（世界坐标）
    var DEFAULT_NODE_WIDTH = 180;
    var DEFAULT_NODE_HEIGHT = 64;

    // 交互阈值
    var CLICK_MOVE_THRESHOLD = 5;     // 像素
    var CLICK_TIME_THRESHOLD = 250;   // 毫秒

    // localStorage 键
    var STORAGE_KEY = 'gg_growth_graph_data_v1';

    // ===== 共享数据层：生长线与关系图谱关联的存储键 =====
    // 总关系图谱：{ nodes, edges, savedAt, centerNodeIds }
    var MASTER_GRAPH_KEY = 'gg_master_graph';
    // 以某节点为中心的关系图谱：{ centerNodeId, nodes, edges, savedAt }
    function nodeGraphKey(nodeId) { return 'gg_node_graph_' + nodeId; }

    /**
     * 创建默认节点
     * @param {string} title
     * @param {number} x
     * @param {number} y
     */
    function createNode(title, x, y) {
        return {
            id: 'node_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            title: title || '未命名',
            note: '',
            color: NODE_COLOR_PRESETS[0],
            x: x || 0,
            y: y || 0,
            width: DEFAULT_NODE_WIDTH,
            height: DEFAULT_NODE_HEIGHT,
            parentIds: [],
            childIds: [],
            createdAt: Date.now()
        };
    }

    /**
     * 创建默认边
     */
    function createEdge(sourceId, targetId, note) {
        return {
            id: 'edge_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            source: sourceId,
            target: targetId,
            note: note || '',
            color: EDGE_COLOR_PRESETS[0],
            createdAt: Date.now()
        };
    }

    /**
     * 根据 URL 判断内容类型（视频/文章）
     * 参考 ui.js 的 detectContentType 逻辑
     * @param {string} url
     * @returns {string} 'video' 或 'article'
     */
    function detectContentTypeFromUrl(url) {
        if (!url) return 'video';
        var lower = url.toLowerCase();
        // 视频链接特征
        if (lower.indexOf('/video/') >= 0 || lower.indexOf('/watch') >= 0 ||
            lower.indexOf('bilibili.com/video') >= 0 || lower.indexOf('youtube.com') >= 0 ||
            lower.indexOf('youtu.be') >= 0) {
            return 'video';
        }
        // 文章链接特征
        if (lower.indexOf('/read/') >= 0 || lower.indexOf('/cv') >= 0 ||
            lower.indexOf('medium.com') >= 0 || lower.indexOf('zhihu.com') >= 0 ||
            lower.indexOf('/opus/') >= 0) {
            return 'article';
        }
        return 'video';
    }

    /**
     * 从 videoDB 的 ContentInfo 对象创建生长线节点
     * 保留原始 id / title / type / url / desc / tags / addDate
     * @param {ContentInfo} video
     * @param {number} index 用于网格布局
     */
    function createNodeFromVideo(video, index) {
        index = index || 0;
        var colorIdx = index % NODE_COLOR_PRESETS.length;
        // 优先使用 videoDB 中的 type，若缺失则根据 URL 判断
        var nodeType = video.type || detectContentTypeFromUrl(video.url);
        return {
            id: video.id,                          // 使用 videoDB 原始 id
            title: video.title || '未命名',
            note: video.desc || '',                // 描述作为备注
            color: NODE_COLOR_PRESETS[colorIdx],
            x: 100 + (index % 4) * 220,
            y: 100 + Math.floor(index / 4) * 100,
            width: DEFAULT_NODE_WIDTH,
            height: DEFAULT_NODE_HEIGHT,
            parentIds: [],
            childIds: [],
            createdAt: Date.now(),
            // 以下为 videoDB 元数据，用于增量扫描和类型过滤
            _type: nodeType,
            _url: video.url || '',
            _desc: video.desc || '',
            _tags: video.tags || [],
            _addDate: video.addDate || Date.now()
        };
    }

    /* ========================================================
     * 模块2: 状态管理 Store (类模拟 Zustand)
     * ======================================================== */

    function GraphStore() {
        this.state = {
            nodes: [],
            edges: [],
            mode: 'edit',          // 'edit' | 'evolve'
            viewMode: 'local',     // 'local' | 'global'
            showNodeNotes: true,
            showEdgeNotes: true,
            canvasScale: 1,        // 画布大小滑块
            targetFps: 60,
            // 选中和连线状态
            selectedNodeId: null,
            linkingFrom: null,     // 创建母子线时的起点节点 id
            // 生长动画
            isGrowing: false,
            growthProgress: 0,     // 0~1
            growthVisibleIds: null // 生长时可见节点集合
        };
        this._listeners = [];
    }

    GraphStore.prototype.subscribe = function (fn) {
        this._listeners.push(fn);
    };

    GraphStore.prototype.emit = function () {
        for (var i = 0; i < this._listeners.length; i++) {
            try { this._listeners[i](this.state); } catch (e) { console.error(e); }
        }
    };

    GraphStore.prototype.setState = function (partial) {
        for (var k in partial) {
            if (Object.prototype.hasOwnProperty.call(partial, k)) {
                this.state[k] = partial[k];
            }
        }
        this.emit();
    };

    // ---- 节点 CRUD ----
    GraphStore.prototype.addNode = function (node) {
        this.state.nodes.push(node);
        this.emit();
        return node;
    };

    GraphStore.prototype.updateNode = function (id, patch) {
        var n = this.findNode(id);
        if (n) {
            for (var k in patch) {
                if (Object.prototype.hasOwnProperty.call(patch, k)) n[k] = patch[k];
            }
            this.emit();
        }
    };

    /**
     * 删除节点：级联删除关联 Edge，清理其他节点的 parent/child 引用
     */
    GraphStore.prototype.removeNode = function (id) {
        var self = this;
        // 删除关联边，并清理引用
        var remainEdges = [];
        for (var i = 0; i < this.state.edges.length; i++) {
            var e = this.state.edges[i];
            if (e.source === id || e.target === id) {
                // 跳过（删除）
                continue;
            }
            remainEdges.push(e);
        }
        this.state.edges = remainEdges;
        // 清理其他节点的引用
        for (var j = 0; j < this.state.nodes.length; j++) {
            var n = this.state.nodes[j];
            n.parentIds = (n.parentIds || []).filter(function (pid) { return pid !== id; });
            n.childIds = (n.childIds || []).filter(function (cid) { return cid !== id; });
        }
        // 删除节点本身
        this.state.nodes = this.state.nodes.filter(function (n) { return n.id !== id; });
        if (this.state.selectedNodeId === id) this.state.selectedNodeId = null;
        if (this.state.linkingFrom === id) this.state.linkingFrom = null;
        this.emit();
    };

    GraphStore.prototype.findNode = function (id) {
        for (var i = 0; i < this.state.nodes.length; i++) {
            if (this.state.nodes[i].id === id) return this.state.nodes[i];
        }
        return null;
    };

    // ---- 边 CRUD ----
    GraphStore.prototype.addEdge = function (sourceId, targetId, note) {
        var s = this.findNode(sourceId);
        var t = this.findNode(targetId);
        if (!s || !t || sourceId === targetId) return null;
        // 类型隔离：视频节点仅与视频节点关联，文章节点仅与文章节点关联
        if (s._type && t._type && s._type !== t._type) return null;
        // 避免重复
        for (var i = 0; i < this.state.edges.length; i++) {
            var e = this.state.edges[i];
            if (e.source === sourceId && e.target === targetId) return null;
        }
        var edge = createEdge(sourceId, targetId, note);
        this.state.edges.push(edge);
        // 维护 parent/child 引用：source 是 parent，target 是 child
        if (s.childIds.indexOf(targetId) < 0) s.childIds.push(targetId);
        if (t.parentIds.indexOf(sourceId) < 0) t.parentIds.push(sourceId);
        this.emit();
        return edge;
    };

    GraphStore.prototype.updateEdge = function (id, patch) {
        for (var i = 0; i < this.state.edges.length; i++) {
            if (this.state.edges[i].id === id) {
                for (var k in patch) {
                    if (Object.prototype.hasOwnProperty.call(patch, k)) {
                        this.state.edges[i][k] = patch[k];
                    }
                }
                this.emit();
                return;
            }
        }
    };

    GraphStore.prototype.removeEdge = function (id) {
        var edge = null;
        for (var i = 0; i < this.state.edges.length; i++) {
            if (this.state.edges[i].id === id) { edge = this.state.edges[i]; break; }
        }
        if (!edge) return;
        this.state.edges = this.state.edges.filter(function (e) { return e.id !== id; });
        // 清理引用
        var s = this.findNode(edge.source);
        var t = this.findNode(edge.target);
        if (s) s.childIds = (s.childIds || []).filter(function (cid) { return cid !== edge.target; });
        if (t) t.parentIds = (t.parentIds || []).filter(function (pid) { return pid !== edge.source; });
        this.emit();
    };

    GraphStore.prototype.findEdge = function (sourceId, targetId) {
        for (var i = 0; i < this.state.edges.length; i++) {
            var e = this.state.edges[i];
            if (e.source === sourceId && e.target === targetId) return e;
        }
        return null;
    };

    GraphStore.prototype.findEdgeById = function (edgeId) {
        for (var i = 0; i < this.state.edges.length; i++) {
            if (this.state.edges[i].id === edgeId) return this.state.edges[i];
        }
        return null;
    };

    // ---- 模式切换 ----
    GraphStore.prototype.toggleMode = function (mode) {
        this.state.mode = mode;
        if (mode === 'edit') {
            this.state.isGrowing = false;
            this.state.growthVisibleIds = null;
            this.state.growthProgress = 0;
        }
        this.emit();
    };

    /* ========================================================
     * 模块3: 摄像机系统
     * ======================================================== */

    function Camera() {
        // 世界坐标中的摄像机中心
        this.x = 0;
        this.y = 0;
        this.zoom = 1;
        // 目标值（平滑跟随）
        this.targetX = 0;
        this.targetY = 0;
        this.targetZoom = 1;
        // 画布像素尺寸（由主壳层更新）
        this.viewportWidth = 800;
        this.viewportHeight = 600;
    }

    /** 世界坐标 -> 屏幕坐标 */
    Camera.prototype.worldToScreen = function (wx, wy) {
        return {
            x: (wx - this.x) * this.zoom + this.viewportWidth / 2,
            y: (wy - this.y) * this.zoom + this.viewportHeight / 2
        };
    };

    /** 屏幕坐标 -> 世界坐标 */
    Camera.prototype.screenToWorld = function (sx, sy) {
        return {
            x: (sx - this.viewportWidth / 2) / this.zoom + this.x,
            y: (sy - this.viewportHeight / 2) / this.zoom + this.y
        };
    };

    /**
     * 平滑 Lerp 跟随
     * target += (goal - target) * (1 - Math.exp(-5 * dt))
     */
    Camera.prototype.update = function (dt) {
        var k = 1 - Math.exp(-5 * dt);
        this.x += (this.targetX - this.x) * k;
        this.y += (this.targetY - this.y) * k;
        // zoom 用稍快的跟随
        var kz = 1 - Math.exp(-8 * dt);
        this.zoom += (this.targetZoom - this.zoom) * kz;
    };

    /** 立即跳到目标（无平滑） */
    Camera.prototype.snapToTarget = function () {
        this.x = this.targetX;
        this.y = this.targetY;
        this.zoom = this.targetZoom;
    };

    /**
     * 计算所有可见节点的包围盒并 fit zoom
     */
    Camera.prototype.fitNodes = function (nodes, padding) {
        padding = padding || 80;
        if (!nodes || nodes.length === 0) return;
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + n.width);
            maxY = Math.max(maxY, n.y + n.height);
        }
        var cx = (minX + maxX) / 2;
        var cy = (minY + maxY) / 2;
        var w = maxX - minX + padding * 2;
        var h = maxY - minY + padding * 2;
        var zoomX = this.viewportWidth / w;
        var zoomY = this.viewportHeight / h;
        var zoom = Math.min(zoomX, zoomY, 2); // 上限 2
        zoom = Math.max(zoom, 0.15);
        this.targetX = cx;
        this.targetY = cy;
        this.targetZoom = zoom;
    };

    /** 聚焦单个节点 */
    Camera.prototype.focusNode = function (node, zoom) {
        this.targetX = node.x + node.width / 2;
        this.targetY = node.y + node.height / 2;
        if (zoom) this.targetZoom = zoom;
    };

    /* ========================================================
     * 模块4: 拓扑排序器 (DFS 三色标记法)
     * ======================================================== */

    /**
     * @param {Array} nodes
     * @param {Array} edges  edge.source -> edge.target 表示 parent -> child
     * @returns {Array} 节点 id 数组，顺序即为生长出现顺序
     */
    function topologicalSort(nodes, edges) {
        // 构建邻接表（parent -> [children]）
        var adj = {};
        var idSet = {};
        for (var i = 0; i < nodes.length; i++) {
            var id = nodes[i].id;
            idSet[id] = true;
            adj[id] = [];
        }
        for (var j = 0; j < edges.length; j++) {
            var e = edges[j];
            if (idSet[e.source] && idSet[e.target]) {
                adj[e.source].push(e.target);
            }
        }
        // 三色：0=白(未访问), 1=灰(正在访问), 2=黑(已完成)
        var color = {};
        var result = [];
        var hasCycle = false;
        var dfsStack = []; // 用于环检测后的 fallback 顺序

        function dfs(startId) {
            // 迭代式 DFS 避免栈溢出
            var stack = [{ id: startId, idx: 0 }];
            color[startId] = 1;
            while (stack.length > 0) {
                var top = stack[stack.length - 1];
                var neighbors = adj[top.id] || [];
                if (top.idx < neighbors.length) {
                    var nextId = neighbors[top.idx++];
                    if (color[nextId] === undefined) {
                        color[nextId] = 1;
                        stack.push({ id: nextId, idx: 0 });
                    } else if (color[nextId] === 1) {
                        // 灰色：发现环
                        hasCycle = true;
                    }
                    // 黑色则跳过
                } else {
                    color[top.id] = 2;
                    result.push(top.id);
                    stack.pop();
                }
            }
        }

        // 按节点创建顺序作为 DFS 起点顺序（稳定）
        for (var k = 0; k < nodes.length; k++) {
            var nid = nodes[k].id;
            if (color[nid] === undefined) {
                dfs(nid);
            }
        }

        // 拓扑排序结果需要反转（后序 -> 拓扑序）
        result.reverse();

        if (hasCycle) {
            // fallback：以 DFS 发现顺序，保证所有节点都出现
            // result 已经包含所有节点，但顺序可能在环处不严格拓扑
            // 这里采用：保证每个节点出现一次即可
        }

        // 确保所有节点都在结果中（孤立节点）
        for (var m = 0; m < nodes.length; m++) {
            if (result.indexOf(nodes[m].id) < 0) {
                result.push(nodes[m].id);
            }
        }

        return result;
    }

    /* ========================================================
     * 模块5: Canvas 渲染引擎
     * ======================================================== */

    function Renderer(canvas, camera, store) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.camera = camera;
        this.store = store;
        this.dpr = window.devicePixelRatio || 1;
        this.lastTime = performance.now();
        // 用于连线生长动画的进度缓存
        this._edgeProgress = {};
    }

    Renderer.prototype.resize = function (w, h) {
        this.dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.floor(w * this.dpr);
        this.canvas.height = Math.floor(h * this.dpr);
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.camera.viewportWidth = w;
        this.camera.viewportHeight = h;
    };

    /** 圆角矩形辅助 */
    function roundRect(ctx, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    /** 主渲染入口 */
    Renderer.prototype.render = function (time) {
        var ctx = this.ctx;
        var state = this.store.state;
        var cam = this.camera;

        // 设置变换：使用 dpr 缩放
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        // 清屏（透明，让 CSS 渐变背景显示）
        ctx.clearRect(0, 0, cam.viewportWidth, cam.viewportHeight);

        // 1. 绘制背景网格
        this.drawGrid(ctx, cam);

        // 计算可见节点集合
        var visibleIds = null;
        if (state.isGrowing && state.growthVisibleIds) {
            visibleIds = state.growthVisibleIds;
        }

        // 2. 绘制连线
        this.drawEdges(ctx, state, cam, visibleIds, time);

        // 3. 绘制节点
        this.drawNodes(ctx, state, cam, visibleIds, time);

        // 4. 绘制连线中预览（创建母子线时）
        if (state.linkingFrom && this._linkingMouse) {
            this.drawLinkingPreview(ctx, state, cam);
        }
    };

    /** 背景网格 */
    Renderer.prototype.drawGrid = function (ctx, cam) {
        var gridSize = 50 * cam.zoom;
        if (gridSize < 10) return; // 太小不画
        var offsetX = ((-cam.x * cam.zoom + cam.viewportWidth / 2) % gridSize + gridSize) % gridSize;
        var offsetY = ((-cam.y * cam.zoom + cam.viewportHeight / 2) % gridSize + gridSize) % gridSize;
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var x = offsetX; x < cam.viewportWidth; x += gridSize) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, cam.viewportHeight);
        }
        for (var y = offsetY; y < cam.viewportHeight; y += gridSize) {
            ctx.moveTo(0, y);
            ctx.lineTo(cam.viewportWidth, y);
        }
        ctx.stroke();
    };

    /** 绘制所有可见连线 */
    Renderer.prototype.drawEdges = function (ctx, state, cam, visibleIds, time) {
        for (var i = 0; i < state.edges.length; i++) {
            var edge = state.edges[i];
            // 生长模式：只画可见的
            if (visibleIds) {
                if (!visibleIds[edge.source] || !visibleIds[edge.target]) continue;
            }
            var s = this.store.findNode(edge.source);
            var t = this.store.findNode(edge.target);
            if (!s || !t) continue;

            // 计算生长进度（如果正在生长）
            var progress = 1;
            if (state.isGrowing) {
                progress = this._edgeProgress[edge.id];
                if (progress === undefined) progress = 1;
            }

            this.drawEdge(ctx, edge, s, t, cam, progress, state);
        }
    };

    /** 绘制单条连线（贝塞尔曲线 + 生长动画） */
    Renderer.prototype.drawEdge = function (ctx, edge, s, t, cam, progress, state) {
        // 连接点：source 右侧中点 -> target 左侧中点
        var sx = s.x + s.width;
        var sy = s.y + s.height / 2;
        var tx = t.x;
        var ty = t.y + t.height / 2;

        // 生长：终点插值
        var ex = sx + (tx - sx) * progress;
        var ey = sy + (ty - sy) * progress;

        var p1 = cam.worldToScreen(sx, sy);
        var p2 = cam.worldToScreen(ex, ey);

        // 控制点（贝塞尔）
        var midX = (p1.x + p2.x) / 2;
        var c1x = midX, c1y = p1.y;
        var c2x = midX, c2y = p2.y;

        ctx.strokeStyle = edge.color || EDGE_COLOR_PRESETS[0];
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
        ctx.stroke();

        // 箭头（仅在进度接近 1 时绘制）
        if (progress > 0.95) {
            var angle = Math.atan2(p2.y - c2y, p2.x - c2x);
            var arrowSize = 8;
            ctx.fillStyle = edge.color || EDGE_COLOR_PRESETS[0];
            ctx.beginPath();
            ctx.moveTo(p2.x, p2.y);
            ctx.lineTo(p2.x - arrowSize * Math.cos(angle - Math.PI / 6),
                       p2.y - arrowSize * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(p2.x - arrowSize * Math.cos(angle + Math.PI / 6),
                       p2.y - arrowSize * Math.sin(angle + Math.PI / 6));
            ctx.closePath();
            ctx.fill();
        }

        // 连线备注
        if (state.showEdgeNotes && edge.note && progress > 0.9) {
            var labelX = (p1.x + p2.x) / 2;
            var labelY = (p1.y + p2.y) / 2;
            var label = edge.note;
            ctx.font = '11px ' + '-apple-system, sans-serif';
            var metrics = ctx.measureText(label);
            var padX = 6, padY = 3;
            // 毛玻璃背景
            ctx.fillStyle = 'rgba(30,33,48,0.75)';
            roundRect(ctx, labelX - metrics.width / 2 - padX, labelY - 8 - padY,
                      metrics.width + padX * 2, 16 + padY * 2, 8);
            ctx.fill();
            ctx.fillStyle = '#e4e6f0';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, labelX, labelY);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
        }
    };

    /** 绘制所有可见节点 */
    Renderer.prototype.drawNodes = function (ctx, state, cam, visibleIds, time) {
        for (var i = 0; i < state.nodes.length; i++) {
            var node = state.nodes[i];
            // 生长模式：只画可见的
            if (visibleIds && !visibleIds[node.id]) continue;
            this.drawNode(ctx, node, state, cam, time);
        }
    };

    /** 绘制单个节点卡片（圆角矩形 + 色条 + 文字 + 毛玻璃） */
    Renderer.prototype.drawNode = function (ctx, node, state, cam, time) {
        var pos = cam.worldToScreen(node.x, node.y);
        var w = node.width * cam.zoom;
        var h = node.height * cam.zoom;
        var x = pos.x;
        var y = pos.y;

        // 视口剔除
        if (x + w < -50 || x > cam.viewportWidth + 50 ||
            y + h < -50 || y > cam.viewportHeight + 50) return;

        var isSelected = state.selectedNodeId === node.id;
        var isLinkingFrom = state.linkingFrom === node.id;
        var radius = 10 * cam.zoom;

        // 阴影
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 16 * cam.zoom;
        ctx.shadowOffsetY = 4 * cam.zoom;

        // 毛玻璃背景（半透明白）
        ctx.fillStyle = 'rgba(30,33,48,0.55)';
        roundRect(ctx, x, y, w, h, radius);
        ctx.fill();

        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;

        // 左侧色条
        ctx.fillStyle = node.color || NODE_COLOR_PRESETS[0];
        roundRect(ctx, x, y, 5 * cam.zoom, h, radius);
        ctx.fill();
        // 覆盖色条右侧圆角
        ctx.fillStyle = node.color || NODE_COLOR_PRESETS[0];
        ctx.fillRect(x + 2 * cam.zoom, y, 3 * cam.zoom, h);

        // 选中/连线高亮边框
        if (isSelected || isLinkingFrom) {
            ctx.strokeStyle = isLinkingFrom ? '#22c55e' : '#818cf8';
            ctx.lineWidth = 2;
            roundRect(ctx, x, y, w, h, radius);
            ctx.stroke();
        } else {
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 1;
            roundRect(ctx, x, y, w, h, radius);
            ctx.stroke();
        }

        // 文字（按 zoom 缩放，但有下限保证可读）
        var fontZoom = Math.max(cam.zoom, 0.6);
        var titleSize = 13 * fontZoom;
        ctx.font = '600 ' + titleSize + 'px ' + '-apple-system, sans-serif';
        ctx.fillStyle = '#e4e6f0';
        ctx.textBaseline = 'top';
        // 裁剪文字
        var textX = x + 14 * cam.zoom;
        var maxTextWidth = w - 20 * cam.zoom;
        var title = this.truncateText(ctx, node.title, maxTextWidth);
        ctx.fillText(title, textX, y + 12 * cam.zoom);

        // 备注
        if (state.showNodeNotes && node.note) {
            var noteSize = 11 * fontZoom;
            ctx.font = noteSize + 'px ' + '-apple-system, sans-serif';
            ctx.fillStyle = '#8b8fa3';
            var note = this.truncateText(ctx, node.note, maxTextWidth);
            ctx.fillText(note, textX, y + 12 * cam.zoom + titleSize + 4 * cam.zoom);
        }

        ctx.textBaseline = 'alphabetic';

        // 右上角删除按钮（红叉）
        var delSize = 14 * cam.zoom;
        var delX = x + w - delSize - 4 * cam.zoom;
        var delY = y + 4 * cam.zoom;
        // 背景圆
        ctx.fillStyle = 'rgba(239, 68, 68, 0.85)';
        ctx.beginPath();
        ctx.arc(delX + delSize / 2, delY + delSize / 2, delSize / 2, 0, Math.PI * 2);
        ctx.fill();
        // 白色叉号
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1.5, 1.5 * cam.zoom);
        ctx.lineCap = 'round';
        var pad = delSize * 0.25;
        ctx.beginPath();
        ctx.moveTo(delX + pad, delY + pad);
        ctx.lineTo(delX + delSize - pad, delY + delSize - pad);
        ctx.moveTo(delX + delSize - pad, delY + pad);
        ctx.lineTo(delX + pad, delY + delSize - pad);
        ctx.stroke();
    };

    /** 命中测试：检测点击是否在节点右上角的删除按钮上 */
    Renderer.prototype.hitTestDeleteButton = function (sx, sy) {
        var cam = this.camera;
        var state = this.store.state;
        for (var i = state.nodes.length - 1; i >= 0; i--) {
            var node = state.nodes[i];
            var visibleIds = state.growthVisibleIds;
            if (state.isGrowing && visibleIds && !visibleIds[node.id]) continue;
            var pos = cam.worldToScreen(node.x, node.y);
            var w = node.width * cam.zoom;
            var delSize = 14 * cam.zoom;
            var delX = pos.x + w - delSize - 4 * cam.zoom;
            var delY = pos.y + 4 * cam.zoom;
            var cx = delX + delSize / 2;
            var cy = delY + delSize / 2;
            var dx = sx - cx;
            var dy = sy - cy;
            if (dx * dx + dy * dy <= (delSize / 2) * (delSize / 2)) {
                return node;
            }
        }
        return null;
    };

    /** 创建母子线时的预览线 */
    Renderer.prototype.drawLinkingPreview = function (ctx, state, cam) {
        var from = this.store.findNode(state.linkingFrom);
        if (!from) return;
        var sx = from.x + from.width;
        var sy = from.y + from.height / 2;
        var p1 = cam.worldToScreen(sx, sy);
        var p2 = this._linkingMouse;

        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.setLineDash([]);
    };

    /** 截断文字 */
    Renderer.prototype.truncateText = function (ctx, text, maxWidth) {
        if (ctx.measureText(text).width <= maxWidth) return text;
        var truncated = text;
        while (truncated.length > 0 && ctx.measureText(truncated + '…').width > maxWidth) {
            truncated = truncated.slice(0, -1);
        }
        return truncated + '…';
    };

    /** 命中测试：屏幕坐标 -> 节点 */
    Renderer.prototype.hitTestNode = function (sx, sy) {
        var cam = this.camera;
        var state = this.store.state;
        // 从后往前（顶层优先）
        for (var i = state.nodes.length - 1; i >= 0; i--) {
            var node = state.nodes[i];
            var visibleIds = state.growthVisibleIds;
            if (state.isGrowing && visibleIds && !visibleIds[node.id]) continue;
            var pos = cam.worldToScreen(node.x, node.y);
            var w = node.width * cam.zoom;
            var h = node.height * cam.zoom;
            if (sx >= pos.x && sx <= pos.x + w && sy >= pos.y && sy <= pos.y + h) {
                return node;
            }
        }
        return null;
    };

    /** 命中测试：屏幕坐标 -> 连线（点到贝塞尔曲线的距离） */
    Renderer.prototype.hitTestEdge = function (sx, sy) {
        var cam = this.camera;
        var state = this.store.state;
        var threshold = 8; // 像素容差

        for (var i = 0; i < state.edges.length; i++) {
            var edge = state.edges[i];
            var visibleIds = state.growthVisibleIds;
            if (state.isGrowing && visibleIds) {
                if (!visibleIds[edge.source] || !visibleIds[edge.target]) continue;
            }
            var s = this.store.findNode(edge.source);
            var t = this.store.findNode(edge.target);
            if (!s || !t) continue;

            // 连接点：source 右侧中点 -> target 左侧中点
            var sxw = s.x + s.width;
            var syw = s.y + s.height / 2;
            var txw = t.x;
            var tyw = t.y + t.height / 2;

            var p1 = cam.worldToScreen(sxw, syw);
            var p2 = cam.worldToScreen(txw, tyw);

            // 贝塞尔控制点
            var midX = (p1.x + p2.x) / 2;
            var c1x = midX, c1y = p1.y;
            var c2x = midX, c2y = p2.y;

            // 采样检测：在曲线上取 N 个点，检测最近距离
            var N = 20;
            var prevX = p1.x, prevY = p1.y;
            for (var j = 1; j <= N; j++) {
                var u = j / N;
                // 三次贝塞尔曲线点
                var x = (1-u)*(1-u)*(1-u)*p1.x + 3*(1-u)*(1-u)*u*c1x + 3*(1-u)*u*u*c2x + u*u*u*p2.x;
                var y = (1-u)*(1-u)*(1-u)*p1.y + 3*(1-u)*(1-u)*u*c1y + 3*(1-u)*u*u*c2y + u*u*u*p2.y;
                // 点到线段 (prevX,prevY)-(x,y) 的距离
                var dist = this._pointToSegmentDist(sx, sy, prevX, prevY, x, y);
                if (dist <= threshold) return edge;
                prevX = x;
                prevY = y;
            }
        }
        return null;
    };

    /** 点到线段的距离 */
    Renderer.prototype._pointToSegmentDist = function (px, py, x1, y1, x2, y2) {
        var dx = x2 - x1;
        var dy = y2 - y1;
        var lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
        var t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        var cx = x1 + t * dx;
        var cy = y1 + t * dy;
        return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
    };

    /* ========================================================
     * 模块6: 交互管理器
     * ======================================================== */

    function InteractionManager(canvas, store, camera, renderer, callbacks) {
        this.canvas = canvas;
        this.store = store;
        this.camera = camera;
        this.renderer = renderer;
        this.callbacks = callbacks || {};

        // 状态机
        this.state = 'IDLE'; // IDLE | POINTER_DOWN | DRAG_NODE | PAN
        this.pointerDownPos = null;
        this.pointerDownTime = 0;
        this.draggedNode = null;
        this.dragOffset = { x: 0, y: 0 };
        // 双指缩放
        this.pinchStartDist = 0;
        this.pinchStartZoom = 1;
        this.pinchCenter = null;
        // 鼠标位置（世界坐标，用于连线预览）
        this.mouseScreen = null;

        this._bind();
    }

    InteractionManager.prototype._bind = function () {
        var self = this;
        this.canvas.addEventListener('pointerdown', function (e) { self.onPointerDown(e); });
        this.canvas.addEventListener('pointermove', function (e) { self.onPointerMove(e); });
        this.canvas.addEventListener('pointerup', function (e) { self.onPointerUp(e); });
        this.canvas.addEventListener('pointercancel', function (e) { self.onPointerUp(e); });
        // 滚轮缩放
        this.canvas.addEventListener('wheel', function (e) { self.onWheel(e); }, { passive: false });
        // 双指缩放（touch）
        this.canvas.addEventListener('touchstart', function (e) { self.onTouchStart(e); }, { passive: false });
        this.canvas.addEventListener('touchmove', function (e) { self.onTouchMove(e); }, { passive: false });
    };

    InteractionManager.prototype.getCanvasPos = function (e) {
        var rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    InteractionManager.prototype.onPointerDown = function (e) {
        var state = this.store.state;
        // 演化/生长模式禁用节点拖拽
        if (state.mode === 'evolve' || state.isGrowing) {
            // 仍允许平移
            this.state = 'PAN';
            this.pointerDownPos = this.getCanvasPos(e);
            this.pointerDownTime = Date.now();
            this.canvas.classList.add('dragging');
            return;
        }

        var pos = this.getCanvasPos(e);
        this.pointerDownPos = pos;
        this.pointerDownTime = Date.now();

        // 优先检测：是否点击了节点的删除按钮
        var delNode = this.renderer.hitTestDeleteButton(pos.x, pos.y);
        if (delNode) {
            if (confirm('确定要删除节点「' + (delNode.title || '未命名') + '」及其所有连线吗？')) {
                this.store.removeNode(delNode.id);
                if (this.callbacks.onNodeDragEnd) this.callbacks.onNodeDragEnd(delNode);
            }
            return;
        }

        var node = this.renderer.hitTestNode(pos.x, pos.y);
        if (node) {
            // 创建母子线模式
            if (this.store.state.linkingFrom) {
                if (this.store.state.linkingFrom !== node.id) {
                    // 检查类型兼容性：视频仅与视频关联，文章仅与文章关联
                    var fromNode = this.store.findNode(this.store.state.linkingFrom);
                    if (fromNode && fromNode._type && node._type && fromNode._type !== node._type) {
                        if (this.callbacks.onLinkRejected) this.callbacks.onLinkRejected('类型不匹配：视频节点只能与视频节点关联，文章节点只能与文章节点关联');
                    } else {
                        this.store.addEdge(this.store.state.linkingFrom, node.id, '');
                        if (this.callbacks.onLinkComplete) this.callbacks.onLinkComplete();
                    }
                }
                this.store.setState({ linkingFrom: null });
                this.canvas.classList.remove('linking');
                return;
            }
            // 开始拖拽节点
            this.state = 'POINTER_DOWN';
            this.draggedNode = node;
            var worldPos = this.camera.screenToWorld(pos.x, pos.y);
            this.dragOffset.x = worldPos.x - node.x;
            this.dragOffset.y = worldPos.y - node.y;
        } else {
            // 点击空白
            if (this.store.state.linkingFrom) {
                // 取消连线
                this.store.setState({ linkingFrom: null });
                this.canvas.classList.remove('linking');
                return;
            }
            // 检测是否点击了连线
            var edge = this.renderer.hitTestEdge(pos.x, pos.y);
            if (edge) {
                // 记录点击的边，在 onPointerUp 时触发回调
                this.state = 'POINTER_DOWN';
                this.clickedEdge = edge;
            } else {
                // 开始平移
                this.state = 'PAN';
                this.canvas.classList.add('dragging');
            }
        }
    };

    InteractionManager.prototype.onPointerMove = function (e) {
        var pos = this.getCanvasPos(e);
        this.mouseScreen = pos;
        // 更新 renderer 的连线预览鼠标位置
        this.renderer._linkingMouse = pos;

        if (this.state === 'POINTER_DOWN') {
            // 判定是否超过移动阈值 -> 转为 DRAG_NODE
            var dx = pos.x - this.pointerDownPos.x;
            var dy = pos.y - this.pointerDownPos.y;
            if (Math.sqrt(dx * dx + dy * dy) > CLICK_MOVE_THRESHOLD) {
                this.state = 'DRAG_NODE';
                if (this.callbacks.onNodeDragStart) this.callbacks.onNodeDragStart(this.draggedNode);
            }
        }

        if (this.state === 'DRAG_NODE' && this.draggedNode) {
            var worldPos = this.camera.screenToWorld(pos.x, pos.y);
            this.store.updateNode(this.draggedNode.id, {
                x: worldPos.x - this.dragOffset.x,
                y: worldPos.y - this.dragOffset.y
            });
        } else if (this.state === 'PAN') {
            var dx2 = pos.x - this.pointerDownPos.x;
            var dy2 = pos.y - this.pointerDownPos.y;
            // 屏幕移动 -> 世界移动
            this.camera.targetX -= dx2 / this.camera.zoom;
            this.camera.targetY -= dy2 / this.camera.zoom;
            this.camera.x = this.camera.targetX;
            this.camera.y = this.camera.targetY;
            this.pointerDownPos = pos;
        }
    };

    InteractionManager.prototype.onPointerUp = function (e) {
        var elapsed = Date.now() - this.pointerDownTime;
        if (this.state === 'POINTER_DOWN' && elapsed < CLICK_TIME_THRESHOLD) {
            // 点击节点
            var node = this.draggedNode;
            if (node && this.callbacks.onNodeClick) {
                this.callbacks.onNodeClick(node);
            }
            // 点击连线
            if (!node && this.clickedEdge && this.callbacks.onEdgeClick) {
                this.callbacks.onEdgeClick(this.clickedEdge);
            }
        } else if (this.state === 'PAN' && elapsed < CLICK_TIME_THRESHOLD) {
            // 点击空白
            if (this.callbacks.onCanvasClick) this.callbacks.onCanvasClick();
        }

        if (this.state === 'DRAG_NODE' && this.callbacks.onNodeDragEnd) {
            this.callbacks.onNodeDragEnd(this.draggedNode);
        }

        this.state = 'IDLE';
        this.draggedNode = null;
        this.clickedEdge = null;
        this.pointerDownPos = null;
        this.canvas.classList.remove('dragging');
    };

    InteractionManager.prototype.onWheel = function (e) {
        e.preventDefault();
        var pos = this.getCanvasPos(e);
        var worldBefore = this.camera.screenToWorld(pos.x, pos.y);
        var delta = e.deltaY > 0 ? 1 / 1.15 : 1.15;
        var newZoom = Math.max(0.15, Math.min(4, this.camera.targetZoom * delta));
        this.camera.targetZoom = newZoom;
        this.camera.zoom = newZoom;
        // 保持鼠标位置不变
        var worldAfter = this.camera.screenToWorld(pos.x, pos.y);
        this.camera.targetX += worldBefore.x - worldAfter.x;
        this.camera.targetY += worldBefore.y - worldAfter.y;
        this.camera.x = this.camera.targetX;
        this.camera.y = this.camera.targetY;
        if (this.callbacks.onZoomChange) this.callbacks.onZoomChange(newZoom);
    };

    // ---- 双指缩放 ----
    InteractionManager.prototype.onTouchStart = function (e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            var t0 = e.touches[0], t1 = e.touches[1];
            var dx = t1.clientX - t0.clientX;
            var dy = t1.clientY - t0.clientY;
            this.pinchStartDist = Math.sqrt(dx * dx + dy * dy);
            this.pinchStartZoom = this.camera.targetZoom;
            var rect = this.canvas.getBoundingClientRect();
            this.pinchCenter = {
                x: (t0.clientX + t1.clientX) / 2 - rect.left,
                y: (t0.clientY + t1.clientY) / 2 - rect.top
            };
        }
    };

    InteractionManager.prototype.onTouchMove = function (e) {
        if (e.touches.length === 2 && this.pinchStartDist > 0) {
            e.preventDefault();
            var t0 = e.touches[0], t1 = e.touches[1];
            var dx = t1.clientX - t0.clientX;
            var dy = t1.clientY - t0.clientY;
            var dist = Math.sqrt(dx * dx + dy * dy);
            var scale = dist / this.pinchStartDist;
            var newZoom = Math.max(0.15, Math.min(4, this.pinchStartZoom * scale));
            var worldBefore = this.camera.screenToWorld(this.pinchCenter.x, this.pinchCenter.y);
            this.camera.targetZoom = newZoom;
            this.camera.zoom = newZoom;
            var worldAfter = this.camera.screenToWorld(this.pinchCenter.x, this.pinchCenter.y);
            this.camera.targetX += worldBefore.x - worldAfter.x;
            this.camera.targetY += worldBefore.y - worldAfter.y;
            this.camera.x = this.camera.targetX;
            this.camera.y = this.camera.targetY;
            if (this.callbacks.onZoomChange) this.callbacks.onZoomChange(newZoom);
        }
    };

    /** 开始创建母子线 */
    InteractionManager.prototype.startLinking = function (fromNodeId) {
        this.store.setState({ linkingFrom: fromNodeId });
        this.canvas.classList.add('linking');
    };

    /* ========================================================
     * 模块7: 生长动画控制器
     * ======================================================== */

    function GrowthController(store, camera, renderer) {
        this.store = store;
        this.camera = camera;
        this.renderer = renderer;
        this.totalDuration = 10000; // 10 秒
        this.startTime = 0;
        this.topoOrder = [];
        this.rafId = null;
        this.active = false;
    }

    GrowthController.prototype.start = function (duration) {
        var state = this.store.state;
        if (state.nodes.length === 0) return;
        this.totalDuration = duration || this.totalDuration;
        this.topoOrder = topologicalSort(state.nodes, state.edges);
        this.startTime = performance.now();
        this.active = true;
        // 重置进度缓存
        this.renderer._edgeProgress = {};
        this.store.setState({
            isGrowing: true,
            growthProgress: 0,
            growthVisibleIds: {}
        });
        this._tick();
    };

    GrowthController.prototype.stop = function () {
        this.active = false;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = null;
        this.renderer._edgeProgress = {};
        this.store.setState({
            isGrowing: false,
            growthProgress: 0,
            growthVisibleIds: null
        });
    };

    GrowthController.prototype._tick = function () {
        if (!this.active) return;
        var now = performance.now();
        var elapsed = now - this.startTime;
        var progress = Math.min(1, elapsed / this.totalDuration);

        var state = this.store.state;
        var totalNodes = this.topoOrder.length;
        // visibleCount = Math.floor(topologicalOrder.length * progress)
        var visibleCount = Math.floor(totalNodes * progress);

        // 构建可见集合
        var visibleIds = {};
        for (var i = 0; i < visibleCount && i < this.topoOrder.length; i++) {
            visibleIds[this.topoOrder[i]] = true;
        }

        // 计算每条可见边的生长进度
        var edges = state.edges;
        for (var j = 0; j < edges.length; j++) {
            var edge = edges[j];
            if (!visibleIds[edge.source] || !visibleIds[edge.target]) {
                this.renderer._edgeProgress[edge.id] = 0;
                continue;
            }
            // 新出现的边：计算其出现时间后的进度
            // source 出现的时序位置
            var sourceIdx = this.topoOrder.indexOf(edge.source);
            var targetIdx = this.topoOrder.indexOf(edge.target);
            var appearIdx = Math.max(sourceIdx, targetIdx);
            // 该边在 appearIdx/totalNodes 时刻开始生长，持续 1/totalNodes 时长
            var appearTime = (appearIdx + 1) / totalNodes;
            var edgeDuration = 1 / totalNodes;
            var edgeProgress = (progress - (appearTime - edgeDuration)) / edgeDuration;
            edgeProgress = Math.max(0, Math.min(1, edgeProgress));
            this.renderer._edgeProgress[edge.id] = edgeProgress;
        }

        // 摄像机自动巡航：聚焦最新出现的节点
        if (visibleCount > 0 && state.viewMode === 'local') {
            var latestId = this.topoOrder[Math.min(visibleCount - 1, totalNodes - 1)];
            var latestNode = this.store.findNode(latestId);
            if (latestNode) {
                this.camera.focusNode(latestNode, Math.max(this.camera.targetZoom, 0.8));
            }
        } else if (state.viewMode === 'global') {
            // 全局视角：fit 所有可见节点
            var visibleNodes = [];
            for (var k = 0; k < state.nodes.length; k++) {
                if (visibleIds[state.nodes[k].id]) visibleNodes.push(state.nodes[k]);
            }
            if (visibleNodes.length > 0) {
                this.camera.fitNodes(visibleNodes, 100);
            }
        }

        this.store.setState({
            growthProgress: progress,
            growthVisibleIds: visibleIds
        });

        if (progress >= 1) {
            // 生长完成
            this.active = false;
            this.store.setState({ isGrowing: false });
            if (this.onComplete) this.onComplete();
            return;
        }

        var self = this;
        this.rafId = requestAnimationFrame(function () { self._tick(); });
    };

    /* ========================================================
     * 模块8: 编辑面板组件
     * ======================================================== */

    function EditPanel(store, interaction) {
        this.store = store;
        this.interaction = interaction;
        this.panel = document.getElementById('gg-edit-panel');
        this.titleEl = document.getElementById('gg-panel-title');
        this.titleInput = document.getElementById('gg-node-title');
        this.noteInput = document.getElementById('gg-node-note');
        this.colorPresetsEl = document.getElementById('gg-node-color-presets');
        this.colorPicker = document.getElementById('gg-node-color-picker');
        this.relationsInfoEl = document.getElementById('gg-relations-info');
        this.closeBtn = document.getElementById('gg-panel-close');
        this.linkBtn = document.getElementById('gg-start-linking');
        this.deleteBtn = document.getElementById('gg-delete-node');

        this._renderColorPresets();
        this._bind();
    }

    EditPanel.prototype._renderColorPresets = function () {
        var self = this;
        this.colorPresetsEl.innerHTML = '';
        NODE_COLOR_PRESETS.forEach(function (color) {
            var sw = document.createElement('div');
            sw.className = 'gg-color-swatch';
            sw.style.background = color;
            sw.dataset.color = color;
            sw.addEventListener('click', function () {
                self.colorPicker.value = color;
                self._applyColor(color);
            });
            self.colorPresetsEl.appendChild(sw);
        });
    };

    EditPanel.prototype._bind = function () {
        var self = this;
        this.closeBtn.addEventListener('click', function () { self.close(); });
        this.titleInput.addEventListener('input', function () {
            if (self.store.state.selectedNodeId) {
                self.store.updateNode(self.store.state.selectedNodeId, { title: self.titleInput.value });
            }
        });
        this.noteInput.addEventListener('input', function () {
            if (self.store.state.selectedNodeId) {
                self.store.updateNode(self.store.state.selectedNodeId, { note: self.noteInput.value });
            }
        });
        this.colorPicker.addEventListener('input', function () {
            self._applyColor(self.colorPicker.value);
        });
        this.linkBtn.addEventListener('click', function () {
            if (self.store.state.selectedNodeId) {
                self.interaction.startLinking(self.store.state.selectedNodeId);
                self.close();
            }
        });
        this.deleteBtn.addEventListener('click', function () {
            if (self.store.state.selectedNodeId) {
                var node = self.store.findNode(self.store.state.selectedNodeId);
                if (node && confirm('确定要删除节点「' + node.title + '」及其所有关联吗？')) {
                    self.store.removeNode(self.store.state.selectedNodeId);
                    self.close();
                }
            }
        });
    };

    EditPanel.prototype._applyColor = function (color) {
        if (this.store.state.selectedNodeId) {
            this.store.updateNode(this.store.state.selectedNodeId, { color: color });
            this._updateColorSwatchSelection(color);
        }
    };

    EditPanel.prototype._updateColorSwatchSelection = function (color) {
        var swatches = this.colorPresetsEl.querySelectorAll('.gg-color-swatch');
        swatches.forEach(function (sw) {
            if (sw.dataset.color.toLowerCase() === color.toLowerCase()) {
                sw.classList.add('selected');
            } else {
                sw.classList.remove('selected');
            }
        });
    };

    EditPanel.prototype.open = function (nodeId) {
        var node = this.store.findNode(nodeId);
        if (!node) return;
        this.store.setState({ selectedNodeId: nodeId });
        this.titleEl.textContent = '节点编辑';
        this.titleInput.value = node.title;
        this.noteInput.value = node.note || '';
        this.colorPicker.value = node.color || NODE_COLOR_PRESETS[0];
        this._updateColorSwatchSelection(node.color || NODE_COLOR_PRESETS[0]);
        this._renderRelations(node);
        this.panel.classList.add('open');
    };

    EditPanel.prototype.close = function () {
        this.panel.classList.remove('open');
        this.store.setState({ selectedNodeId: null });
    };

    EditPanel.prototype._renderRelations = function (node) {
        var self = this;
        this.relationsInfoEl.innerHTML = '';
        var hasAny = false;
        // 父节点
        (node.parentIds || []).forEach(function (pid) {
            var p = self.store.findNode(pid);
            if (p) {
                hasAny = true;
                var item = document.createElement('span');
                item.className = 'gg-rel-item';
                item.innerHTML = '<span class="gg-rel-arrow">母</span> ' + self._escape(p.title);
                self.relationsInfoEl.appendChild(item);
            }
        });
        // 子节点
        (node.childIds || []).forEach(function (cid) {
            var c = self.store.findNode(cid);
            if (c) {
                hasAny = true;
                var item = document.createElement('span');
                item.className = 'gg-rel-item';
                item.innerHTML = '<span class="gg-rel-arrow">子</span> ' + self._escape(c.title);
                self.relationsInfoEl.appendChild(item);
            }
        });
        if (!hasAny) {
            var empty = document.createElement('span');
            empty.className = 'gg-rel-empty';
            empty.textContent = '暂无母子关系';
            this.relationsInfoEl.appendChild(empty);
        }
    };

    EditPanel.prototype._escape = function (s) {
        var div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    };

    /* ========================================================
     * 模块8b: 节点仓库（存储导入的节点，可添加到画布）
     * ======================================================== */

    function NodeStore(store, camera) {
        this.store = store;
        this.camera = camera;
        this.panel = document.getElementById('gg-node-store');
        this.body = document.getElementById('gg-store-body');
        this.toggleBtn = document.getElementById('gg-store-toggle');
        // 存储的节点列表（不在画布上的）
        this.storedNodes = [];
        // 已在画布上的节点 id 集合
        this._onCanvasIds = new Set();
        this._bind();
    }

    NodeStore.prototype._bind = function () {
        var self = this;
        // 折叠/展开
        this.toggleBtn.addEventListener('click', function () {
            self.panel.classList.toggle('collapsed');
            // 保存折叠状态
            try {
                localStorage.setItem('gg_node_store_collapsed', self.panel.classList.contains('collapsed') ? '1' : '0');
            } catch (e) { /* ignore */ }
        });
        // 恢复折叠状态
        try {
            if (localStorage.getItem('gg_node_store_collapsed') === '1') {
                this.panel.classList.add('collapsed');
            }
        } catch (e) { /* ignore */ }
    };

    /**
     * 设置仓库中的节点（替换全部）
     * @param {Array} nodes 要存储的节点数组
     * @param {boolean} clearCanvas 是否同时清空画布上的节点
     */
    NodeStore.prototype.setNodes = function (nodes, clearCanvas) {
        this.storedNodes = nodes ? nodes.slice() : [];
        this._onCanvasIds.clear();
        if (clearCanvas) {
            this.store.state.nodes = [];
            this.store.state.edges = [];
        }
        this._render();
    };

    /**
     * 添加节点到仓库
     */
    NodeStore.prototype.addNodes = function (nodes) {
        for (var i = 0; i < nodes.length; i++) {
            // 避免重复
            var exists = false;
            for (var j = 0; j < this.storedNodes.length; j++) {
                if (this.storedNodes[j].id === nodes[i].id) { exists = true; break; }
            }
            if (!exists) this.storedNodes.push(nodes[i]);
        }
        this._render();
    };

    /**
     * 将节点从仓库添加到画布
     */
    NodeStore.prototype.addToCanvas = function (nodeId) {
        var node = null;
        for (var i = 0; i < this.storedNodes.length; i++) {
            if (this.storedNodes[i].id === nodeId) {
                node = this.storedNodes[i];
                break;
            }
        }
        if (!node) return;

        // 检查是否已在画布上
        if (this.store.findNode(nodeId)) {
            this._onCanvasIds.add(nodeId);
            this._render();
            return;
        }

        // 克隆节点数据，放在画布中心附近
        var newNode = {
            id: node.id,
            title: node.title || '未命名',
            note: node.note || '',
            color: node.color || NODE_COLOR_PRESETS[0],
            x: -DEFAULT_NODE_WIDTH / 2 + (Math.random() - 0.5) * 60,
            y: -DEFAULT_NODE_HEIGHT / 2 + (Math.random() - 0.5) * 60,
            width: DEFAULT_NODE_WIDTH,
            height: DEFAULT_NODE_HEIGHT,
            parentIds: [],
            childIds: [],
            createdAt: Date.now()
        };
        // 保留 videoDB 元数据
        if (node._type) newNode._type = node._type;
        if (node._url) newNode._url = node._url;
        if (node._desc) newNode._desc = node._desc;
        if (node._tags) newNode._tags = node._tags;
        if (node._addDate) newNode._addDate = node._addDate;

        this.store.addNode(newNode);
        this._onCanvasIds.add(nodeId);

        // 聚焦到新节点
        this.camera.focusNode(newNode, 1);
        this.camera.snapToTarget();

        this._render();
    };

    /**
     * 渲染仓库列表（按类型分组：视频/文章）
     */
    NodeStore.prototype._render = function () {
        var self = this;
        if (!this.body) return;
        this.body.innerHTML = '';

        if (this.storedNodes.length === 0) {
            this.body.innerHTML = '<div class="gg-store-empty">暂无存储节点<br>点击「导入总图谱」加载</div>';
            return;
        }

        // 更新已在画布上的节点集合
        var canvasIds = {};
        for (var i = 0; i < this.store.state.nodes.length; i++) {
            canvasIds[this.store.state.nodes[i].id] = true;
        }

        // 按类型分组
        var videoNodes = [];
        var articleNodes = [];
        this.storedNodes.forEach(function (node) {
            var nodeType = node._type || 'video';
            if (nodeType === 'article') {
                articleNodes.push(node);
            } else {
                videoNodes.push(node);
            }
        });

        // 渲染视频分组
        if (videoNodes.length > 0) {
            this._renderGroup('🎬 视频（' + videoNodes.length + '）', videoNodes, canvasIds);
        }
        // 渲染文章分组
        if (articleNodes.length > 0) {
            this._renderGroup('📄 文章（' + articleNodes.length + '）', articleNodes, canvasIds);
        }
    };

    /**
     * 渲染一个分组
     */
    NodeStore.prototype._renderGroup = function (title, nodes, canvasIds) {
        var self = this;
        var groupEl = document.createElement('div');
        groupEl.className = 'gg-store-group';

        var header = document.createElement('div');
        header.className = 'gg-store-group-header';
        header.textContent = title;
        groupEl.appendChild(header);

        nodes.forEach(function (node) {
            var onCanvas = !!canvasIds[node.id];
            var item = document.createElement('div');
            item.className = 'gg-store-item' + (onCanvas ? ' on-canvas' : '');
            item.dataset.nodeId = node.id;

            var colorDot = document.createElement('div');
            colorDot.className = 'gg-store-item-color';
            colorDot.style.background = node.color || NODE_COLOR_PRESETS[0];

            var titleEl = document.createElement('div');
            titleEl.className = 'gg-store-item-title';
            titleEl.textContent = node.title || '未命名';
            titleEl.title = node.title || '';

            var addIcon = document.createElement('span');
            addIcon.className = 'gg-store-item-add';
            addIcon.textContent = onCanvas ? '✓' : '+';

            item.appendChild(colorDot);
            item.appendChild(titleEl);
            item.appendChild(addIcon);

            if (!onCanvas) {
                item.addEventListener('click', function () {
                    self.addToCanvas(node.id);
                });
            }

            groupEl.appendChild(item);
        });

        this.body.appendChild(groupEl);
    };

    /**
     * 刷新仓库状态（节点添加到画布后调用）
     */
    NodeStore.prototype.refresh = function () {
        this._render();
    };

    /* ========================================================
     * 模块8c: 连线编辑面板
     * ======================================================== */

    function EdgeEditPanel(store) {
        this.store = store;
        this.panel = document.getElementById('gg-edge-panel');
        this.titleEl = document.getElementById('gg-edge-panel-title');
        this.noteInput = document.getElementById('gg-edge-note');
        this.colorPresetsEl = document.getElementById('gg-edge-color-presets');
        this.colorPicker = document.getElementById('gg-edge-color-picker');
        this.closeBtn = document.getElementById('gg-edge-panel-close');
        this.saveBtn = document.getElementById('gg-save-edge');
        this.deleteBtn = document.getElementById('gg-delete-edge');
        this.selectedEdgeId = null;
        // 暂存编辑中的值，点击保存后才应用
        this._pendingNote = '';
        this._pendingColor = '';
        this._renderColorPresets();
        this._bind();
    }

    EdgeEditPanel.prototype._renderColorPresets = function () {
        var self = this;
        this.colorPresetsEl.innerHTML = '';
        EDGE_COLOR_PRESETS.forEach(function (color) {
            var sw = document.createElement('div');
            sw.className = 'gg-color-swatch';
            sw.style.background = color;
            sw.dataset.color = color;
            sw.addEventListener('click', function () {
                self.colorPicker.value = color;
                self._applyColor(color);
            });
            self.colorPresetsEl.appendChild(sw);
        });
    };

    EdgeEditPanel.prototype._bind = function () {
        var self = this;
        this.closeBtn.addEventListener('click', function () { self.close(); });
        // 输入时仅暂存，不立即应用
        this.noteInput.addEventListener('input', function () {
            self._pendingNote = self.noteInput.value;
        });
        this.colorPicker.addEventListener('input', function () {
            self._pendingColor = self.colorPicker.value;
            self._updateColorSwatchSelection(self.colorPicker.value);
        });
        // 保存按钮：将暂存的修改应用到实际边数据
        this.saveBtn.addEventListener('click', function () {
            if (self.selectedEdgeId) {
                var edge = self.store.findEdgeById(self.selectedEdgeId);
                if (edge) {
                    edge.note = self._pendingNote;
                    edge.color = self._pendingColor;
                    self.store.emit();
                    if (self._app && self._app._showHint) {
                        self._app._showHint('关系已保存', 1500);
                    }
                }
            }
        });
        this.deleteBtn.addEventListener('click', function () {
            if (self.selectedEdgeId) {
                if (confirm('确定要删除这条连线吗？')) {
                    self.store.removeEdge(self.selectedEdgeId);
                    self.close();
                }
            }
        });
    };

    EdgeEditPanel.prototype._applyColor = function (color) {
        // 仅暂存，不立即应用（由保存按钮统一应用）
        this._pendingColor = color;
        this._updateColorSwatchSelection(color);
    };

    EdgeEditPanel.prototype._updateColorSwatchSelection = function (color) {
        var swatches = this.colorPresetsEl.querySelectorAll('.gg-color-swatch');
        swatches.forEach(function (sw) {
            if (sw.dataset.color.toLowerCase() === color.toLowerCase()) {
                sw.classList.add('selected');
            } else {
                sw.classList.remove('selected');
            }
        });
    };

    EdgeEditPanel.prototype.open = function (edgeId) {
        var edge = this.store.findEdgeById(edgeId);
        if (!edge) return;
        this.selectedEdgeId = edgeId;
        var sNode = this.store.findNode(edge.source);
        var tNode = this.store.findNode(edge.target);
        var sTitle = sNode ? sNode.title : '?';
        var tTitle = tNode ? tNode.title : '?';
        this.titleEl.textContent = sTitle + ' → ' + tTitle;
        this.noteInput.value = edge.note || '';
        this.colorPicker.value = edge.color || EDGE_COLOR_PRESETS[0];
        this._updateColorSwatchSelection(edge.color || EDGE_COLOR_PRESETS[0]);
        // 初始化暂存值
        this._pendingNote = edge.note || '';
        this._pendingColor = edge.color || EDGE_COLOR_PRESETS[0];
        this.panel.classList.add('open');
    };

    EdgeEditPanel.prototype.close = function () {
        this.panel.classList.remove('open');
        this.selectedEdgeId = null;
    };

    /* ========================================================
     * 模块9: 顶部控制栏
     * ======================================================== */

    function TopBar(store, growth, camera) {
        this.store = store;
        this.growth = growth;
        this.camera = camera;
        this._bind();
    }

    TopBar.prototype._bind = function () {
        var self = this;

        // 模式切换
        document.getElementById('gg-mode-edit').addEventListener('click', function () {
            self.store.toggleMode('edit');
            self._updateModeButtons();
        });
        document.getElementById('gg-mode-evolve').addEventListener('click', function () {
            self.store.toggleMode('evolve');
            self._updateModeButtons();
        });

        // 显示控制
        document.getElementById('gg-show-node-notes').addEventListener('change', function (e) {
            self.store.setState({ showNodeNotes: e.target.checked });
        });
        document.getElementById('gg-show-edge-notes').addEventListener('change', function (e) {
            self.store.setState({ showEdgeNotes: e.target.checked });
        });

        // 画布大小
        document.getElementById('gg-canvas-scale').addEventListener('input', function (e) {
            self.store.setState({ canvasScale: parseFloat(e.target.value) });
            self.camera.targetZoom = parseFloat(e.target.value);
        });

        // 视角切换
        document.getElementById('gg-view-local').addEventListener('click', function () {
            self.store.setState({ viewMode: 'local' });
            self._updateViewButtons();
        });
        document.getElementById('gg-view-global').addEventListener('click', function () {
            self.store.setState({ viewMode: 'global' });
            self._updateViewButtons();
            self._fitAllNodes();
        });

        // 帧率
        document.getElementById('gg-fps-select').addEventListener('change', function (e) {
            self.store.setState({ targetFps: parseInt(e.target.value, 10) });
        });

        // 添加节点 - 显示下拉菜单
        document.getElementById('gg-add-node').addEventListener('click', function (e) {
            e.stopPropagation();
            self._showAddNodeDropdown(this);
        });

        // 添加空白节点
        document.getElementById('gg-add-blank-node').addEventListener('click', function () {
            self._hideAddNodeDropdown();
            self._addBlankNode();
        });

        // 添加已导入的视频/文章节点
        document.getElementById('gg-add-video-node').addEventListener('click', function () {
            self._hideAddNodeDropdown();
            self._showVideoPicker();
        });

        // 点击外部关闭下拉菜单
        document.addEventListener('click', function (e) {
            var dropdown = document.getElementById('gg-add-node-dropdown');
            var addBtn = document.getElementById('gg-add-node');
            if (dropdown && dropdown.style.display !== 'none') {
                if (!dropdown.contains(e.target) && e.target !== addBtn) {
                    self._hideAddNodeDropdown();
                }
            }
        });

        // 视频/文章选择器：关闭按钮
        document.getElementById('gg-video-picker-close').addEventListener('click', function () {
            self._hideVideoPicker();
        });

        // 视频/文章选择器：点击遮罩关闭
        document.getElementById('gg-video-picker-overlay').addEventListener('click', function (e) {
            if (e.target === this) self._hideVideoPicker();
        });

        // 视频/文章选择器：搜索
        document.getElementById('gg-video-picker-search').addEventListener('input', function () {
            self._filterVideoPicker(this.value);
        });

        // 视频/文章选择器：类型滑动开关
        document.getElementById('gg-picker-type-toggle').addEventListener('click', function () {
            var isArticle = this.classList.contains('article');
            if (isArticle) {
                // 切换到视频
                this.classList.remove('article');
                self._pickerTypeFilter = 'video';
            } else {
                // 切换到文章
                this.classList.add('article');
                self._pickerTypeFilter = 'article';
            }
            var searchEl2 = document.getElementById('gg-video-picker-search');
            self._renderVideoPickerList(searchEl2 ? searchEl2.value : '');
        });

        // 开始/停止生长
        document.getElementById('gg-start-growth').addEventListener('click', function () {
            self.store.toggleMode('evolve');
            self._updateModeButtons();
            self.growth.start(10000);
            self._toggleGrowthButtons(true);
        });
        document.getElementById('gg-stop-growth').addEventListener('click', function () {
            self.growth.stop();
            self._toggleGrowthButtons(false);
        });

        // 导出
        document.getElementById('gg-export').addEventListener('click', function () {
            self._exportHTML();
        });

        // ===== 关联关系图谱：导入/保存 =====
        // 从关系图谱导入：加载 videoDB 节点 + 自动扫描关系
        var importRelationsBtn = document.getElementById('gg-import-relations');
        if (importRelationsBtn) {
            importRelationsBtn.addEventListener('click', function () {
                self._importFromRelationsGraph();
            });
        }
        // 导入总图谱：从 videoDB 加载所有节点 + 已有的总图谱关系
        var importMasterBtn = document.getElementById('gg-import-master');
        if (importMasterBtn) {
            importMasterBtn.addEventListener('click', function () {
                self._importMasterGraph();
            });
        }
        // 保存为总图谱
        var saveMasterBtn = document.getElementById('gg-save-master');
        if (saveMasterBtn) {
            saveMasterBtn.addEventListener('click', function () {
                self._saveAsMasterGraph();
            });
        }
        // 保存为节点图谱（仅在节点中心模式显示）
        var saveNodeBtn = document.getElementById('gg-save-node-graph');
        if (saveNodeBtn) {
            saveNodeBtn.addEventListener('click', function () {
                self._saveAsNodeGraph();
            });
        }

        // 重置
        document.getElementById('gg-reset-data').addEventListener('click', function () {
            if (confirm('确定要重置所有数据吗？此操作不可撤销。')) {
                localStorage.removeItem(STORAGE_KEY);
                location.reload();
            }
        });

        // 顶部栏「更多」按钮：窄屏时展开/收起溢出按钮
        var moreBtn = document.getElementById('gg-more-btn');
        var overflowContainer = document.getElementById('gg-top-bar-overflow');
        if (moreBtn && overflowContainer) {
            // 将溢出按钮的克隆放入溢出容器
            var overflowBtns = document.querySelectorAll('.gg-overflow-btn');
            overflowBtns.forEach(function (btn) {
                var clone = btn.cloneNode(true);
                clone.className = btn.className.replace('gg-overflow-btn', '').trim();
                clone.id = btn.id + '_clone';
                overflowContainer.appendChild(clone);
            });
            // 展开/收起
            moreBtn.addEventListener('click', function () {
                overflowContainer.classList.toggle('open');
                moreBtn.textContent = overflowContainer.classList.contains('open') ? '收起 ▲' : '更多 ▼';
            });
            // 给克隆的按钮绑定事件（委托到溢出容器）
            overflowContainer.addEventListener('click', function (e) {
                var clicked = e.target.closest('button');
                if (!clicked || !clicked.id) return;
                // 从 clone id 还原原始 id
                var origId = clicked.id.replace('_clone', '');
                var origBtn = document.getElementById(origId);
                if (origBtn) {
                    origBtn.click();
                    // 收起溢出容器
                    overflowContainer.classList.remove('open');
                    moreBtn.textContent = '更多 ▼';
                }
            });
        }

        // 缩放控制
        document.getElementById('gg-zoom-in').addEventListener('click', function () {
            self.camera.targetZoom = Math.min(4, self.camera.targetZoom * 1.2);
        });
        document.getElementById('gg-zoom-out').addEventListener('click', function () {
            self.camera.targetZoom = Math.max(0.15, self.camera.targetZoom / 1.2);
        });
        document.getElementById('gg-zoom-reset').addEventListener('click', function () {
            self.camera.targetZoom = 1;
            self.camera.targetX = 0;
            self.camera.targetY = 0;
        });
    };

    TopBar.prototype._updateModeButtons = function () {
        var mode = this.store.state.mode;
        var editBtn = document.getElementById('gg-mode-edit');
        var evolveBtn = document.getElementById('gg-mode-evolve');
        editBtn.classList.toggle('active', mode === 'edit');
        evolveBtn.classList.toggle('active', mode === 'evolve');
    };

    TopBar.prototype._updateViewButtons = function () {
        var view = this.store.state.viewMode;
        document.getElementById('gg-view-local').classList.toggle('active', view === 'local');
        document.getElementById('gg-view-global').classList.toggle('active', view === 'global');
    };

    TopBar.prototype._fitAllNodes = function () {
        var nodes = this.store.state.nodes;
        if (nodes.length > 0) {
            this.camera.fitNodes(nodes, 100);
        }
    };

    TopBar.prototype._toggleGrowthButtons = function (growing) {
        document.getElementById('gg-start-growth').style.display = growing ? 'none' : '';
        document.getElementById('gg-stop-growth').style.display = growing ? '' : 'none';
    };

    TopBar.prototype._showAddNodeDropdown = function (anchorBtn) {
        var dropdown = document.getElementById('gg-add-node-dropdown');
        if (!dropdown) return;

        // 切换显示/隐藏
        if (dropdown.style.display !== 'none') {
            this._hideAddNodeDropdown();
            return;
        }

        // 定位到按钮下方
        var rect = anchorBtn.getBoundingClientRect();
        dropdown.style.display = 'block';
        var dropdownRect = dropdown.getBoundingClientRect();
        var left = rect.left;
        // 避免超出右侧视口
        if (left + dropdownRect.width > window.innerWidth - 8) {
            left = window.innerWidth - dropdownRect.width - 8;
        }
        dropdown.style.left = left + 'px';
        dropdown.style.top = (rect.bottom + 4) + 'px';
    };

    TopBar.prototype._hideAddNodeDropdown = function () {
        var dropdown = document.getElementById('gg-add-node-dropdown');
        if (dropdown) dropdown.style.display = 'none';
    };

    TopBar.prototype._addBlankNode = function () {
        // 在视口中心创建节点
        var wx = this.camera.x;
        var wy = this.camera.y;
        var title = '节点 ' + (this.store.state.nodes.length + 1);
        var node = createNode(title, wx - DEFAULT_NODE_WIDTH / 2, wy - DEFAULT_NODE_HEIGHT / 2);
        // 循环使用预设颜色
        node.color = NODE_COLOR_PRESETS[this.store.state.nodes.length % NODE_COLOR_PRESETS.length];
        this.store.addNode(node);
        if (this._app) this._app._showHint('已添加空白节点', 1500);
    };

    /**
     * 显示视频/文章选择器，从 videoDB 加载已导入的内容
     */
    TopBar.prototype._showVideoPicker = function () {
        var self = this;
        var overlay = document.getElementById('gg-video-picker-overlay');
        var listEl = document.getElementById('gg-video-picker-list');
        var searchEl = document.getElementById('gg-video-picker-search');
        var countEl = document.getElementById('gg-video-picker-count');
        var toggleEl = document.getElementById('gg-picker-type-toggle');
        if (!overlay || !listEl) return;

        // 清空搜索框
        if (searchEl) searchEl.value = '';
        // 默认显示视频
        this._pickerTypeFilter = 'video';
        if (toggleEl) toggleEl.classList.remove('article');

        // 显示加载中
        listEl.innerHTML = '<div class="gg-picker-empty">加载中...</div>';
        overlay.style.display = 'flex';
        if (countEl) countEl.textContent = '';

        // 从 videoDB 加载所有视频/文章
        initVideoDB().then(function () {
            return videoDB.getAllVideos();
        }).then(function (videos) {
            self._pickerVideos = videos || [];
            // 按添加时间倒序
            self._pickerVideos.sort(function (a, b) { return (b.addDate || 0) - (a.addDate || 0); });
            self._renderVideoPickerList('');
        }).catch(function (err) {
            console.error('加载视频列表失败:', err);
            listEl.innerHTML = '<div class="gg-picker-empty">加载失败: ' + (err.message || err) + '</div>';
        });
    };

    TopBar.prototype._hideVideoPicker = function () {
        var overlay = document.getElementById('gg-video-picker-overlay');
        if (overlay) overlay.style.display = 'none';
        this._pickerVideos = null;
    };

    /**
     * 渲染视频/文章选择器列表
     */
    TopBar.prototype._renderVideoPickerList = function (searchQuery) {
        var self = this;
        var listEl = document.getElementById('gg-video-picker-list');
        var countEl = document.getElementById('gg-video-picker-count');
        if (!listEl || !this._pickerVideos) return;

        var videos = this._pickerVideos;

        // 类型过滤：根据滑动开关状态筛选
        var typeFilter = this._pickerTypeFilter || 'video';
        videos = videos.filter(function (v) {
            var nodeType = v.type || detectContentTypeFromUrl(v.url);
            return nodeType === typeFilter;
        });

        // 搜索过滤
        if (searchQuery && searchQuery.trim()) {
            var q = searchQuery.toLowerCase().trim();
            videos = videos.filter(function (v) {
                return (v.title || '').toLowerCase().indexOf(q) >= 0 ||
                       (v.desc || '').toLowerCase().indexOf(q) >= 0 ||
                       (Array.isArray(v.tags) ? v.tags : []).some(function (t) { return String(t).toLowerCase().indexOf(q) >= 0; });
            });
        }

        listEl.innerHTML = '';

        if (videos.length === 0) {
            listEl.innerHTML = '<div class="gg-picker-empty">暂无匹配的内容</div>';
            if (countEl) countEl.textContent = '0 条';
            return;
        }

        // 获取已在画布上的节点 id 集合
        var canvasIds = {};
        for (var i = 0; i < this.store.state.nodes.length; i++) {
            canvasIds[this.store.state.nodes[i].id] = true;
        }

        videos.forEach(function (video, idx) {
            var onCanvas = !!canvasIds[video.id];
            var item = document.createElement('div');
            item.className = 'gg-picker-item' + (onCanvas ? ' on-canvas' : '');

            var nodeType = video.type || detectContentTypeFromUrl(video.url);
            var typeLabel = nodeType === 'article' ? '文章' : '视频';

            var typeEl = document.createElement('span');
            typeEl.className = 'gg-picker-item-type ' + (nodeType === 'article' ? 'article' : 'video');
            typeEl.textContent = typeLabel;

            var titleEl = document.createElement('span');
            titleEl.className = 'gg-picker-item-title';
            titleEl.textContent = video.title || '未命名';
            titleEl.title = video.title || '';

            var statusEl = document.createElement('span');
            statusEl.className = 'gg-picker-item-status';
            statusEl.textContent = onCanvas ? '✓ 已在画布' : '+ 添加';

            item.appendChild(typeEl);
            item.appendChild(titleEl);
            item.appendChild(statusEl);

            if (!onCanvas) {
                item.addEventListener('click', function () {
                    self._addNodeFromVideo(video, idx);
                });
            }

            listEl.appendChild(item);
        });

        if (countEl) {
            countEl.textContent = videos.length + ' 条' + (searchQuery ? ' (已筛选)' : '');
        }
    };

    TopBar.prototype._filterVideoPicker = function (query) {
        this._renderVideoPickerList(query);
    };

    /**
     * 从视频/文章创建节点并添加到画布
     */
    TopBar.prototype._addNodeFromVideo = function (video, index) {
        var self = this;
        // 检查是否已在画布上
        if (this.store.findNode(video.id)) {
            if (this._app) this._app._showHint('该内容已在画布上', 2000);
            return;
        }
        var nodeIdx = this.store.state.nodes.length;
        var node = createNodeFromVideo(video, nodeIdx);
        // 放在视口中心
        var wx = this.camera.x;
        var wy = this.camera.y;
        node.x = wx - DEFAULT_NODE_WIDTH / 2 + (Math.random() - 0.5) * 40;
        node.y = wy - DEFAULT_NODE_HEIGHT / 2 + (Math.random() - 0.5) * 40;
        // 循环使用预设颜色
        node.color = NODE_COLOR_PRESETS[nodeIdx % NODE_COLOR_PRESETS.length];

        this.store.addNode(node);

        // 聚焦到新节点
        this.camera.focusNode(node, 1);
        this.camera.snapToTarget();

        if (this._app) this._app._showHint('已添加「' + (video.title || '未命名') + '」到画布', 2000);

        // 刷新选择器列表（标记为已在画布）
        var searchEl = document.getElementById('gg-video-picker-search');
        this._renderVideoPickerList(searchEl ? searchEl.value : '');
    };

    TopBar.prototype._exportHTML = function () {
        var data = {
            nodes: this.store.state.nodes,
            edges: this.store.state.edges
        };
        // 导出为 JSON 文件下载
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'growth-graph-' + Date.now() + '.json';
        a.click();
        URL.revokeObjectURL(url);
    };

    // ===== 关联关系图谱：导入/保存方法 =====

    /**
     * 从关系图谱导入：加载 videoDB 所有节点 + 自动扫描关系
     * 复用关系图谱的 detectRelation 逻辑，将结果导入生长线
     */
    TopBar.prototype._importFromRelationsGraph = function () {
        var self = this;
        // 先加载已保存的关系图谱关系（localStorage.relationsGraph）
        var savedEdges = [];
        var savedNodePos = {};
        try {
            var raw = localStorage.getItem('relationsGraph');
            if (raw) {
                var savedGraph = JSON.parse(raw);
                if (savedGraph.edges) savedEdges = savedGraph.edges;
                if (savedGraph.nodes) {
                    for (var si = 0; si < savedGraph.nodes.length; si++) {
                        savedNodePos[savedGraph.nodes[si].id] = savedGraph.nodes[si];
                    }
                }
            }
        } catch (e) { /* ignore */ }

        initVideoDB().then(function () {
            return videoDB.getAllVideos();
        }).then(function (videos) {
            if (!videos || videos.length === 0) {
                alert('数据库中暂无视频/文章');
                return;
            }

            // 创建节点（使用 videoDB 原始 id）
            var newNodes = [];
            var nodeMap = {};
            for (var i = 0; i < videos.length; i++) {
                var node = createNodeFromVideo(videos[i], i);
                // 保留已保存的位置
                var saved = savedNodePos[videos[i].id];
                if (saved) {
                    node.x = saved.x;
                    node.y = saved.y;
                }
                newNodes.push(node);
                nodeMap[videos[i].id] = node;
            }

            // 构建边：优先使用已保存的关系，缺失的自动扫描
            var newEdges = [];
            var existingPairs = {};

            // 1. 加载已保存的关系（仅保留同类型节点之间的连接）
            for (var ei = 0; ei < savedEdges.length; ei++) {
                var se = savedEdges[ei];
                if (nodeMap[se.source] && nodeMap[se.target]) {
                    // 过滤跨类型连接：视频仅与视频关联，文章仅与文章关联
                    if (nodeMap[se.source]._type !== nodeMap[se.target]._type) continue;
                    var pair = se.source + '|' + se.target;
                    if (!existingPairs[pair]) {
                        newEdges.push({
                            id: se.id || ('edge_imp_' + Date.now() + '_' + ei),
                            source: se.source,
                            target: se.target,
                            note: se.label || '',
                            color: EDGE_COLOR_PRESETS[newEdges.length % EDGE_COLOR_PRESETS.length],
                            createdAt: Date.now()
                        });
                        existingPairs[pair] = true;
                    }
                }
            }

            // 2. 自动扫描缺失的关系（同类型节点之间）
            // 复用关系图谱的 detectRelation 逻辑
            var scannedCount = 0;
            for (var a = 0; a < videos.length; a++) {
                for (var b = a + 1; b < videos.length; b++) {
                    var vA = videos[a], vB = videos[b];
                    // 只扫同类型：优先用 type 字段，缺失时根据 URL 判断
                    var typeA = vA.type || detectContentTypeFromUrl(vA.url);
                    var typeB = vB.type || detectContentTypeFromUrl(vB.url);
                    if (typeA !== typeB) continue;

                    var pair1 = vA.id + '|' + vB.id;
                    var pair2 = vB.id + '|' + vA.id;
                    if (existingPairs[pair1] || existingPairs[pair2]) continue;

                    var relation = self._detectRelationInline(vA, vB);
                    if (relation) {
                        newEdges.push({
                            id: 'edge_scan_' + Date.now() + '_' + scannedCount,
                            source: vA.id,
                            target: vB.id,
                            note: relation,
                            color: EDGE_COLOR_PRESETS[newEdges.length % EDGE_COLOR_PRESETS.length],
                            createdAt: Date.now()
                        });
                        existingPairs[pair1] = true;
                        scannedCount++;
                    }
                }
            }

            // 清空当前 store 并加载
            self.store.state.nodes = newNodes;
            self.store.state.edges = newEdges;
            self._app._rebuildReferences();
            self.store.emit();

            // 径向布局：以第一个节点为中心
            if (newNodes.length > 0) {
                self._applyRadialLayoutForGrowth(newNodes[0].id, newNodes, newEdges);
                self.camera.fitNodes(newNodes, 100);
            }

            self._dataSource = 'master';
            self._updateDataSourceUI();
            if (self._app) self._app._showHint(
                '已导入 ' + newNodes.length + ' 节点、' + newEdges.length + ' 关系（其中扫描新增 ' + scannedCount + '）', 3000
            );
        }).catch(function (err) {
            console.error('从关系图谱导入失败:', err);
            alert('导入失败: ' + err.message);
        });
    };

    /**
     * 关系检测（内联实现，复用关系图谱的 detectRelation 逻辑）
     * @param {ContentInfo} nodeA
     * @param {ContentInfo} nodeB
     * @returns {string|null}
     */
    TopBar.prototype._detectRelationInline = function (nodeA, nodeB) {
        var rawTagsA = nodeA && nodeA.tags;
        var rawTagsB = nodeB && nodeB.tags;
        if (!Array.isArray(rawTagsA)) rawTagsA = typeof rawTagsA === 'string' ? rawTagsA.split(',') : [];
        if (!Array.isArray(rawTagsB)) rawTagsB = typeof rawTagsB === 'string' ? rawTagsB.split(',') : [];
        var tagsA = rawTagsA.map(function (t) { return String(t).trim(); }).filter(function (t) { return t; });
        var tagsB = rawTagsB.map(function (t) { return String(t).trim(); }).filter(function (t) { return t; });

        // 1. 共同标签：完整词精确匹配（参考关系图谱的共同标签显示）
        var commonTags = [];
        for (var ti = 0; ti < tagsA.length; ti++) {
            for (var tj = 0; tj < tagsB.length; tj++) {
                if (tagsA[ti] === tagsB[tj]) { commonTags.push(tagsA[ti]); break; }
            }
        }
        if (commonTags.length > 0) return '共同标签: ' + commonTags.join(', ');

        // 2. 描述关键词：仅匹配完整词（以空格/标点分隔的独立词），要求至少 3 个字符
        // 避免断章取义：不做子串匹配，只做完整词精确匹配
        var descA = (nodeA.desc || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ');
        var descB = (nodeB.desc || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ');
        var segsA = descA.split(/\s+/).filter(function (w) { return w.length >= 3; });
        var segsB = descB.split(/\s+/).filter(function (w) { return w.length >= 3; });
        // 使用 Set 确保精确匹配，避免子串匹配
        var segsBSet = {};
        for (var si = 0; si < segsB.length; si++) { segsBSet[segsB[si]] = true; }
        var common = [];
        for (var sj = 0; sj < segsA.length; sj++) {
            if (segsBSet[segsA[sj]] && common.indexOf(segsA[sj]) < 0) {
                common.push(segsA[sj]);
            }
        }
        if (common.length >= 2) return '描述相关: ' + common.slice(0, 3).join('、');
        if (common.length === 1 && common[0].length >= 3) return '描述相关: ' + common[0];
        return null;
    };

    /**
     * 生长线内的径向布局：以指定节点为中心，按关系强度排布
     */
    TopBar.prototype._applyRadialLayoutForGrowth = function (centerNodeId, nodes, edges) {
        var centerNode = null;
        for (var ci = 0; ci < nodes.length; ci++) {
            if (nodes[ci].id === centerNodeId) { centerNode = nodes[ci]; break; }
        }
        if (!centerNode) return;

        centerNode.x = 0;
        centerNode.y = 0;

        // 收集关联节点
        var related = [];
        for (var i = 0; i < edges.length; i++) {
            var e = edges[i];
            var otherId = null;
            if (e.source === centerNodeId) otherId = e.target;
            else if (e.target === centerNodeId) otherId = e.source;
            if (otherId) {
                for (var j = 0; j < nodes.length; j++) {
                    if (nodes[j].id === otherId) {
                        related.push(nodes[j]);
                        break;
                    }
                }
            }
        }

        // 计算强度并排序
        for (var k = 0; k < related.length; k++) {
            related[k]._relStrength = this._computeStrengthInline(centerNode, related[k]);
        }
        related.sort(function (a, b) { return (b._relStrength || 0) - (a._relStrength || 0); });

        // 径向布局
        var baseRadius = 250;
        var radiusStep = 180;
        var nodesPerRing = 8;
        for (var m = 0; m < related.length; m++) {
            var n = related[m];
            var ring = n._relStrength <= 2 ? 0 : (n._relStrength <= 4 ? 1 : 2);
            var radius = baseRadius + ring * radiusStep;
            var pos = m % nodesPerRing;
            var total = Math.min(nodesPerRing, related.length);
            if (total === 0) total = 1;
            var angle = (pos / total) * Math.PI * 2;
            n.x = Math.cos(angle) * radius;
            n.y = Math.sin(angle) * radius;
        }
    };

    /**
     * 内联关系强度计算（与 _detectRelationInline 保持一致的完整词匹配逻辑）
     */
    TopBar.prototype._computeStrengthInline = function (nodeA, nodeB) {
        var strength = 0;
        var tagsA = Array.isArray(nodeA._tags) ? nodeA._tags : (Array.isArray(nodeA.tags) ? nodeA.tags : []);
        var tagsB = Array.isArray(nodeB._tags) ? nodeB._tags : (Array.isArray(nodeB.tags) ? nodeB.tags : []);
        var common = 0;
        for (var i = 0; i < tagsA.length; i++) {
            for (var j = 0; j < tagsB.length; j++) {
                if (String(tagsA[i]).trim() === String(tagsB[j]).trim()) { common++; break; }
            }
        }
        strength += common * 2;
        var descA = (nodeA._desc || nodeA.note || '').toLowerCase();
        var descB = (nodeB._desc || nodeB.note || '').toLowerCase();
        // 完整词匹配：至少 3 个字符，避免断章取义
        var segsA = descA.replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').split(/\s+/).filter(function (w) { return w.length >= 3; });
        var segsB = descB.replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').split(/\s+/).filter(function (w) { return w.length >= 3; });
        var segsBSet = {};
        for (var si = 0; si < segsB.length; si++) { segsBSet[segsB[si]] = true; }
        var commonWords = 0;
        for (var k = 0; k < segsA.length; k++) { if (segsBSet[segsA[k]]) commonWords++; }
        strength += commonWords + 1;
        return strength;
    };

    /**
     * 导入总图谱：从 videoDB 加载所有节点，合并已有的总图谱关系
     */
    TopBar.prototype._importMasterGraph = function () {
        var self = this;
        initVideoDB().then(function () {
            return videoDB.getAllVideos();
        }).then(function (videos) {
            // 先尝试加载已保存的总图谱（含位置和关系）
            var savedMaster = null;
            try {
                var raw = localStorage.getItem(MASTER_GRAPH_KEY);
                if (raw) savedMaster = JSON.parse(raw);
            } catch (e) { /* ignore */ }

            var existingNodes = (savedMaster && savedMaster.nodes) ? savedMaster.nodes : [];
            var existingEdges = (savedMaster && savedMaster.edges) ? savedMaster.edges : [];
            // 建立 id -> 位置 的映射
            var posMap = {};
            for (var i = 0; i < existingNodes.length; i++) {
                posMap[existingNodes[i].id] = existingNodes[i];
            }

            // 用 videoDB 数据创建节点，保留已有位置
            var newNodes = [];
            for (var j = 0; j < videos.length; j++) {
                var v = videos[j];
                var node = createNodeFromVideo(v, j);
                var saved = posMap[v.id];
                if (saved) {
                    node.x = saved.x;
                    node.y = saved.y;
                    node.color = saved.color || node.color;
                    node.note = saved.note !== undefined ? saved.note : node.note;
                }
                newNodes.push(node);
            }

            // 添加关系图谱中的自定义节点（isCustom: true）
            var customNodeCount = 0;
            for (var k = 0; k < existingNodes.length; k++) {
                var savedNode = existingNodes[k];
                if (savedNode.isCustom) {
                    // 检查是否已存在（避免重复）
                    var exists = false;
                    for (var m = 0; m < newNodes.length; m++) {
                        if (newNodes[m].id === savedNode.id) {
                            exists = true;
                            break;
                        }
                    }
                    if (!exists) {
                        // 转换关系图谱节点为生长线节点格式
                        var customNode = {
                            id: savedNode.id,
                            title: savedNode.title || '未命名',
                            note: savedNode.desc || '',
                            color: savedNode.color || NODE_COLOR_PRESETS[newNodes.length % NODE_COLOR_PRESETS.length],
                            x: savedNode.x || (100 + Math.random() * 400),
                            y: savedNode.y || (100 + Math.random() * 300),
                            width: DEFAULT_NODE_WIDTH,
                            height: DEFAULT_NODE_HEIGHT,
                            parentIds: [],
                            childIds: [],
                            createdAt: Date.now(),
                            _type: savedNode.type || 'custom',
                            _url: savedNode.url || '',
                            _desc: savedNode.desc || '',
                            _tags: savedNode.tags || [],
                            isCustom: true
                        };
                        newNodes.push(customNode);
                        customNodeCount++;
                    }
                }
            }

            if (newNodes.length === 0) {
                alert('数据库中暂无视频/文章，且关系图谱中无自定义节点');
                return;
            }

            // 清空当前 store，将节点存入仓库而非全部显示在画布
            // 保留边数据（当节点添加到画布时，关联的边会自动生效）
            self.store.state.nodes = [];
            self.store.state.edges = existingEdges;
            self._app._rebuildReferences();
            self.store.emit();

            // 将节点存入节点仓库
            if (self._app && self._app.nodeStore) {
                self._app.nodeStore.setNodes(newNodes, false);
            }

            // 标记当前数据来源
            self._dataSource = 'master';
            self._updateDataSourceUI();
            var hintMsg = '已导入 ' + newNodes.length + ' 个节点到仓库';
            if (customNodeCount > 0) {
                hintMsg += '（含' + customNodeCount + '个自定义节点）';
            }
            hintMsg += '、' + existingEdges.length + ' 条关系\n点击左侧仓库中的节点添加到画布';
            if (self._app) self._app._showHint(hintMsg, 3000);
        }).catch(function (err) {
            console.error('导入总图谱失败:', err);
            alert('导入失败: ' + err.message);
        });
    };

    /**
     * 保存为总图谱
     */
    TopBar.prototype._saveAsMasterGraph = function () {
        // 过滤掉自动扫描产生的边（防御性保证落盘无自动边）
        var cleanEdges = this.store.state.edges.filter(function(e) { return !e._isAuto; });
        var data = {
            nodes: this.store.state.nodes.map(function (n) {
                // 清理运行时的 parentIds/childIds（可由 edges 重建）
                return n;
            }),
            edges: cleanEdges,
            savedAt: Date.now(),
            centerNodeIds: []
        };
        try {
            localStorage.setItem(MASTER_GRAPH_KEY, JSON.stringify(data));
            this._dataSource = 'master';
            this._updateDataSourceUI();
            if (this._app) this._app._showHint('已保存为总图谱（含 ' + data.nodes.length + ' 节点、' + data.edges.length + ' 关系）', 2500);
        } catch (e) {
            console.error('保存总图谱失败:', e);
            alert('保存失败: ' + e.message);
        }
    };

    /**
     * 保存为节点图谱（以某节点为中心）
     */
    TopBar.prototype._saveAsNodeGraph = function () {
        if (!this._nodeCenterId) {
            alert('当前不是节点中心模式，无法保存为节点图谱');
            return;
        }
        // 深拷贝节点和边数据，确保序列化时不受引用影响
        var nodesCopy = JSON.parse(JSON.stringify(this.store.state.nodes));
        var edgesCopy = JSON.parse(JSON.stringify(this.store.state.edges));
        // 过滤掉自动扫描产生的边（防御性保证落盘无自动边）
        edgesCopy = edgesCopy.filter(function(e) { return !e._isAuto; });
        var data = {
            centerNodeId: this._nodeCenterId,
            nodes: nodesCopy,
            edges: edgesCopy,
            savedAt: Date.now()
        };
        try {
            var key = nodeGraphKey(this._nodeCenterId);
            var jsonStr = JSON.stringify(data);
            localStorage.setItem(key, jsonStr);
            console.log('[生长线] 节点图谱已保存，key=' + key + '，节点数=' + data.nodes.length + '，边数=' + data.edges.length);
            if (this._app && this._app._showHint) {
                this._app._showHint('已保存为节点图谱（含 ' + data.nodes.length + ' 节点、' + data.edges.length + ' 关系）', 2500);
            } else {
                console.warn('[生长线] _app 或 _showHint 未设置，无法显示提示');
            }
        } catch (e) {
            console.error('保存节点图谱失败:', e);
            alert('保存失败: ' + e.message);
        }
    };

    /**
     * 根据数据来源更新 UI（显示/隐藏「保存为节点图谱」按钮）
     */
    TopBar.prototype._updateDataSourceUI = function () {
        var saveNodeBtn = document.getElementById('gg-save-node-graph');
        if (!saveNodeBtn) return;
        if (this._dataSource === 'node') {
            saveNodeBtn.style.display = '';
        } else {
            saveNodeBtn.style.display = 'none';
        }
    };

    TopBar.prototype.onGrowthComplete = function () {
        this._toggleGrowthButtons(false);
    };

    /* ========================================================
     * 模块10: 主应用壳层
     * ======================================================== */

    function App() {
        this.store = new GraphStore();
        this.camera = new Camera();
        this.canvas = document.getElementById('gg-canvas');
        this.renderer = new Renderer(this.canvas, this.camera, this.store);
        this.interaction = new InteractionManager(this.canvas, this.store, this.camera, this.renderer, {
            onNodeClick: this._onNodeClick.bind(this),
            onCanvasClick: this._onCanvasClick.bind(this),
            onNodeDragStart: this._onNodeDragStart.bind(this),
            onNodeDragEnd: this._onNodeDragEnd.bind(this),
            onZoomChange: this._onZoomChange.bind(this),
            onLinkComplete: this._onLinkComplete.bind(this),
            onLinkRejected: this._onLinkRejected.bind(this),
            onEdgeClick: this._onEdgeClick.bind(this)
        });
        this.growth = new GrowthController(this.store, this.camera, this.renderer);
        this.editPanel = new EditPanel(this.store, this.interaction);
        this.edgeEditPanel = new EdgeEditPanel(this.store);
        this.edgeEditPanel._app = this;
        this.nodeStore = new NodeStore(this.store, this.camera);
        this.topBar = new TopBar(this.store, this.growth, this.camera);
        // 建立双向引用，让 TopBar 能调用 App 的方法
        this.topBar._app = this;

        this.lastFrameTime = performance.now();
        this.frameInterval = 1000 / 60;

        // 解析 URL 参数，判断数据来源
        this._urlParams = new URLSearchParams(window.location.search);
        this._dataSource = this._urlParams.get('source') || 'local';  // 'local' | 'master' | 'node'
        this._nodeCenterId = this._urlParams.get('nodeId') || null;
        // 同步给 TopBar
        this.topBar._dataSource = this._dataSource;
        this.topBar._nodeCenterId = this._nodeCenterId;

        this._init();
    }

    App.prototype._init = function () {
        var self = this;

        // 一次性清理历史自动扫描关系
        this._cleanupAutoScanEdges();

        // 设置状态提示
        this.statusHint = document.getElementById('gg-status-hint');
        this.zoomText = document.getElementById('gg-zoom-text');

        // 监听 store 变化
        this.store.subscribe(function () { /* 渲染循环会自动处理 */ });

        // 设置 growth 完成回调
        this.growth.onComplete = function () {
            self.topBar.onGrowthComplete();
            self._showHint('生长完成');
        };

        // 根据数据来源加载对应数据
        this._loadBySource();

        // 启动自动保存（在数据加载完成后，避免初始化时重复保存）
        this._autoSave();

        // resize
        this._onResize();
        window.addEventListener('resize', function () { self._onResize(); });

        // 启动渲染循环
        this._loop();

        // 更新数据来源 UI
        this.topBar._updateDataSourceUI();

        // 显示初始提示
        if (this._dataSource === 'master') {
            this._showHint('总图谱模式 - 编辑后点击「保存为总图谱」', 3000);
        } else if (this._dataSource === 'node') {
            this._showHint('节点图谱模式 - 编辑后点击「保存为节点图谱」', 3000);
        } else {
            this._showHint('点击「+ 节点」开始创建，或「导入总图谱」加载关系图谱数据', 3000);
        }
    };

    /**
     * 根据 URL source 参数加载对应数据
     */
    App.prototype._loadBySource = function () {
        if (this._dataSource === 'master') {
            this._loadMasterGraphData();
        } else if (this._dataSource === 'node' && this._nodeCenterId) {
            this._loadNodeGraphData(this._nodeCenterId);
        } else {
            // 默认：加载本地草稿
            this._loadOrInitData();
        }
    };

    /**
     * 加载总图谱数据（从 gg_master_graph）
     */
    App.prototype._loadMasterGraphData = function () {
        var raw = localStorage.getItem(MASTER_GRAPH_KEY);
        if (!raw) {
            // 没有保存的总图谱，回退到本地草稿
            this._showHint('暂无保存的总图谱，已加载本地草稿', 2500);
            this._loadOrInitData();
            this._dataSource = 'local';
            this.topBar._dataSource = 'local';
            this.topBar._updateDataSourceUI();
            return;
        }
        try {
            var data = JSON.parse(raw);
            this.store.state.nodes = data.nodes || [];
            this.store.state.edges = data.edges || [];
            this._rebuildReferences();
            if (this.store.state.nodes.length > 0) {
                this.camera.fitNodes(this.store.state.nodes, 100);
                this.camera.snapToTarget();
            }
        } catch (e) {
            console.error('加载总图谱失败', e);
            this._loadOrInitData();
        }
    };

    /**
     * 加载节点中心图谱数据（从 gg_node_graph_<nodeId>）
     * 如果 localStorage 中没有保存的数据，则尝试从 videoDB 实时构建
     */
    App.prototype._loadNodeGraphData = function (nodeId) {
        var self = this;
        var raw = null;
        try { raw = localStorage.getItem(nodeGraphKey(nodeId)); } catch (e) {}
        if (!raw) {
            // 没有保存的节点图谱，尝试从 videoDB 实时构建该中心节点及其关联
            this._buildNodeGraphFromDB(nodeId);
            return;
        }
        try {
            var data = JSON.parse(raw);
            var loadedNodes = data.nodes || [];
            var loadedEdges = data.edges || [];

            // 确保每个节点有正确的 _type（缺失时根据 URL 判断）
            var nodeTypeMap = {};
            for (var ni = 0; ni < loadedNodes.length; ni++) {
                var n = loadedNodes[ni];
                if (!n._type) {
                    n._type = detectContentTypeFromUrl(n._url);
                }
                nodeTypeMap[n.id] = n._type || 'video';
            }

            // 双保险：过滤跨类型连接的边（视频仅与视频关联，文章仅与文章关联）
            var filteredEdges = [];
            for (var ei = 0; ei < loadedEdges.length; ei++) {
                var e = loadedEdges[ei];
                var typeS = nodeTypeMap[e.source];
                var typeT = nodeTypeMap[e.target];
                if (typeS && typeT && typeS !== typeT) continue; // 跳过跨类型连接
                filteredEdges.push(e);
            }

            // ===== 合并 IndexedDB 中保存的手动关系（优先级最高，不会被覆盖）=====
            var validNodeIds = new Set(loadedNodes.map(function(n) { return n.id; }));
            var existingPairs = {};
            for (var ep = 0; ep < filteredEdges.length; ep++) {
                var fe = filteredEdges[ep];
                existingPairs[fe.source + '|' + fe.target] = true;
                existingPairs[fe.target + '|' + fe.source] = true;
            }

            // 异步加载 IndexedDB 中的手动关系并合并
            if (typeof videoDB !== 'undefined' && videoDB && videoDB.loadRelationsEdges) {
                videoDB.loadRelationsEdges().then(function (savedRelations) {
                    if (savedRelations && savedRelations.length > 0) {
                        for (var si = 0; si < savedRelations.length; si++) {
                            var se = savedRelations[si];
                            // 只保留两端节点都存在的边
                            if (!validNodeIds.has(se.source) || !validNodeIds.has(se.target)) continue;
                            var pair = se.source + '|' + se.target;
                            var pairRev = se.target + '|' + se.source;
                            if (existingPairs[pair] || existingPairs[pairRev]) continue;

                            filteredEdges.push({
                                id: se.id || ('edge_saved_' + Date.now() + '_' + si),
                                source: se.source,
                                target: se.target,
                                note: se.label || se.note || '',
                                color: EDGE_COLOR_PRESETS[0],
                                createdAt: Date.now(),
                                _isManual: true
                            });
                            existingPairs[pair] = true;
                            existingPairs[pairRev] = true;
                        }
                        // 更新 store 中的边
                        self.store.state.edges = filteredEdges;
                        self._rebuildReferences();
                    }
                }).catch(function (err) {
                    console.warn('[加载节点图谱] 从 IndexedDB 合并手动关系失败:', err);
                });
            }

            this.store.state.nodes = loadedNodes;
            this.store.state.edges = filteredEdges;
            this._rebuildReferences();
            // 将导入的节点也存入节点仓库（右侧侧边栏）
            if (this.nodeStore && loadedNodes.length > 0) {
                this.nodeStore.setNodes(loadedNodes.slice(), false);
            }
            // 聚焦到中心节点
            var center = this.store.findNode(nodeId);
            if (center) {
                this.camera.focusNode(center, 1);
                this.camera.snapToTarget();
            } else if (this.store.state.nodes.length > 0) {
                this.camera.fitNodes(this.store.state.nodes, 100);
                this.camera.snapToTarget();
            }
        } catch (e) {
            console.error('加载节点图谱失败', e);
            this._loadOrInitData();
        }
    };

    /**
     * 当 localStorage 中没有保存的节点图谱时，从 videoDB 实时构建
     * 优先加载 IndexedDB 中保存的手动关系，然后在此基础上自动扫描补充新关系
     */
    App.prototype._buildNodeGraphFromDB = function (nodeId) {
        var self = this;
        if (typeof initVideoDB !== 'function' || typeof videoDB === 'undefined') {
            this._showHint('暂无该节点的图谱数据，已加载本地草稿', 2500);
            this._loadOrInitData();
            this._dataSource = 'local';
            this.topBar._dataSource = 'local';
            this.topBar._updateDataSourceUI();
            return;
        }
        
        // 同时加载视频数据和已保存的关系数据
        Promise.all([
            initVideoDB().then(function () { return videoDB.getAllVideos(); }),
            videoDB.loadRelationsEdges ? videoDB.loadRelationsEdges() : Promise.resolve([])
        ]).then(function (results) {
            var videos = results[0];
            var savedRelations = results[1] || [];
            
            if (!videos || videos.length === 0) {
                self._showHint('数据库为空，已加载本地草稿', 2500);
                self._loadOrInitData();
                self._dataSource = 'local';
                self.topBar._dataSource = 'local';
                self.topBar._updateDataSourceUI();
                return;
            }
            // 找到中心节点
            var centerVideo = null;
            for (var i = 0; i < videos.length; i++) {
                if (videos[i].id === nodeId) { centerVideo = videos[i]; break; }
            }
            if (!centerVideo) {
                self._showHint('未找到该节点，已加载本地草稿', 2500);
                self._loadOrInitData();
                self._dataSource = 'local';
                self.topBar._dataSource = 'local';
                self.topBar._updateDataSourceUI();
                return;
            }
            // 构建节点列表：中心节点 + 同类型节点（用于自动扫描关系）
            var centerType = centerVideo.type || detectContentTypeFromUrl(centerVideo.url);
            var nodes = [];
            var videoMap = {};
            for (var j = 0; j < videos.length; j++) {
                var v = videos[j];
                var vType = v.type || detectContentTypeFromUrl(v.url);
                if (vType !== centerType) continue; // 只保留同类型节点
                var node = createNodeFromVideo(v, nodes.length);
                nodes.push(node);
                videoMap[v.id] = node;
            }
            
            // ===== 优先加载已保存的手动关系（从 IndexedDB）=====
            var edges = [];
            var existingPairs = {};
            var validNodeIds = new Set(nodes.map(function(n) { return n.id; }));
            
            // 首先加载手动保存的关系（优先级最高）
            for (var si = 0; si < savedRelations.length; si++) {
                var se = savedRelations[si];
                // 只保留两端节点都存在的边
                if (!validNodeIds.has(se.source) || !validNodeIds.has(se.target)) continue;
                
                var pair = se.source + '|' + se.target;
                var pairRev = se.target + '|' + se.source;
                if (existingPairs[pair] || existingPairs[pairRev]) continue;
                
                edges.push({
                    id: se.id || ('edge_saved_' + Date.now() + '_' + si),
                    source: se.source,
                    target: se.target,
                    note: se.label || se.note || '',
                    color: EDGE_COLOR_PRESETS[0],
                    createdAt: Date.now(),
                    _isManual: true  // 标记为手动添加的关系
                });
                existingPairs[pair] = true;
                existingPairs[pairRev] = true;
            }
            
            // ===== 自动扫描已停用：仅保留手动关系 =====
            // 设置到画布
            self.store.state.nodes = nodes;
            self.store.state.edges = edges;
            self._rebuildReferences();
            if (self.nodeStore && nodes.length > 0) {
                self.nodeStore.setNodes(nodes.slice(), false);
            }
            // 聚焦到中心节点
            var center = self.store.findNode(nodeId);
            if (center) {
                self.camera.focusNode(center, 1);
                self.camera.snapToTarget();
            } else if (nodes.length > 0) {
                self.camera.fitNodes(nodes, 100);
                self.camera.snapToTarget();
            }
            self._showHint('已从数据库实时构建节点图谱（保留手动关系）', 2500);
        }).catch(function (err) {
            console.error('从数据库构建节点图谱失败:', err);
            self._showHint('构建节点图谱失败，已加载本地草稿', 2500);
            self._loadOrInitData();
            self._dataSource = 'local';
            self.topBar._dataSource = 'local';
            self.topBar._updateDataSourceUI();
        });
    };

    /**
     * 一次性清理历史自动扫描关系（_isAuto 边）
     * 遍历 localStorage 中的 gg_master_graph 和 gg_node_graph_* 键，
     * 解析后过滤掉 _isAuto 为 true 的边，回写。
     * 使用 localStorage['kb_autoscan_cleaned_v1'] 做一次性守卫。
     */
    App.prototype._cleanupAutoScanEdges = function () {
        var guardKey = 'kb_autoscan_cleaned_v1';
        try {
            if (localStorage.getItem(guardKey)) return; // 已清理过
        } catch (e) { return; }

        var keysToClean = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (key === 'gg_master_graph' || (key && key.indexOf('gg_node_graph_') === 0)) {
                    keysToClean.push(key);
                }
            }
        } catch (e) {
            console.warn('[cleanupAutoScan] 遍历 localStorage 失败:', e);
        }

        var cleanedCount = 0;
        keysToClean.forEach(function(key) {
            try {
                var raw = localStorage.getItem(key);
                if (!raw) return;
                var data = JSON.parse(raw);
                if (data && Array.isArray(data.edges) && data.edges.length > 0) {
                    var before = data.edges.length;
                    data.edges = data.edges.filter(function(e) { return e._isAuto !== true; });
                    var after = data.edges.length;
                    if (after < before) {
                        cleanedCount += (before - after);
                        localStorage.setItem(key, JSON.stringify(data));
                        console.log('[cleanupAutoScan] 清理 ' + key + '：移除 ' + (before - after) + ' 条自动边');
                    }
                }
            } catch (e) {
                console.warn('[cleanupAutoScan] 处理 ' + key + ' 失败:', e);
            }
        });

        if (cleanedCount > 0) {
            console.log('[cleanupAutoScan] 共清理 ' + cleanedCount + ' 条历史自动扫描关系');
        }

        try {
            localStorage.setItem(guardKey, '1');
        } catch (e) {}
    };

    /**
     * 倒排索引自动扫描算法（用于生长线实时构建）
     * 与关系图谱的算法保持一致
     */
    App.prototype._scanWithInvertedIndexForGrowth = function (nodes, existingPairs) {
        var SCAN_CFG = {
            minWordLength: 2,
            maxDFRatio: 0.3,
            minDF: 2,
            topN: 50,
manualStopWords: ['硬核战双', '硬核战双（文字版）', '潮声回响', '战双帕弥什', '战双', '鸣潮'],
forceKeepWords: ['硬核战双', '硬核战双（文字版）', '潮声回响']
        };

        var totalNodes = nodes.length;
        if (totalNodes === 0) return [];

        // 分词函数
        function tokenizeNode(node) {
            var text = '';
            if (node.title) text += node.title + ' ';
            if (node._desc) text += node._desc + ' ';
            if (node._tags) {
                var tags = Array.isArray(node._tags) ? node._tags : String(node._tags).split(',');
                for (var ti = 0; ti < tags.length; ti++) {
                    text += String(tags[ti]).trim() + ' ';
                }
            }
            text = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ');
            var words = [];
            var parts = text.split(/\s+/);
            for (var pi = 0; pi < parts.length; pi++) {
                var part = parts[pi];
                if (!part) continue;
                if (/^[a-z0-9]+$/.test(part)) {
                    if (part.length >= SCAN_CFG.minWordLength) words.push(part);
                    continue;
                }
                for (var ci = 0; ci < part.length - 1; ci++) {
                    words.push(part.substr(ci, 2));
                }
                for (var ci2 = 0; ci2 < part.length - 2; ci2++) {
                    words.push(part.substr(ci2, 3));
                }
            }
            var stopSet = new Set(SCAN_CFG.manualStopWords);
            var forceSet = new Set(SCAN_CFG.forceKeepWords);
            words = words.filter(function (w) {
                if (forceSet.has(w)) return true;
                if (stopSet.has(w)) return false;
                return true;
            });
            var unique = [];
            var seen = {};
            for (var wi = 0; wi < words.length; wi++) {
                if (!seen[words[wi]]) { seen[words[wi]] = true; unique.push(words[wi]); }
            }
            return unique;
        }

        // 构建倒排索引
        var nodeWords = {};
        var index = {};
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var words = tokenizeNode(node);
            nodeWords[node.id] = words;
            for (var wi = 0; wi < words.length; wi++) {
                var word = words[wi];
                if (!index[word]) index[word] = [];
                if (index[word].indexOf(node.id) < 0) index[word].push(node.id);
            }
        }

        // 过滤普遍词和稀有词，计算 IDF
        var forceSet = new Set(SCAN_CFG.forceKeepWords);
        var filteredIndex = {};
        var idfMap = {};
        for (var w in index) {
            if (!Object.prototype.hasOwnProperty.call(index, w)) continue;
            var df = index[w].length;
            if (forceSet.has(w)) {
                filteredIndex[w] = index[w];
                idfMap[w] = Math.log(totalNodes / Math.max(df, 1));
                continue;
            }
            if (totalNodes > 1 && df / totalNodes > SCAN_CFG.maxDFRatio) continue;
            if (df < SCAN_CFG.minDF) continue;
            filteredIndex[w] = index[w];
            idfMap[w] = Math.log(totalNodes / Math.max(df, 1));
        }

        // 构建 nodeMap
        var nodeMap = {};
        for (var ni2 = 0; ni2 < nodes.length; ni2++) {
            nodeMap[nodes[ni2].id] = nodes[ni2];
        }

        // 对每个节点，通过倒排索引查找命中节点
        var newEdges = [];
        for (var i2 = 0; i2 < nodes.length; i2++) {
            var n = nodes[i2];
            var nWords = nodeWords[n.id] || [];
            if (nWords.length === 0) continue;

            var scoreMap = {};
            for (var wi2 = 0; wi2 < nWords.length; wi2++) {
                var word = nWords[wi2];
                var postings = filteredIndex[word];
                if (!postings) continue;
                var idf = idfMap[word] || 1;
                for (var pi2 = 0; pi2 < postings.length; pi2++) {
                    var otherId = postings[pi2];
                    if (otherId === n.id) continue;
                    var otherNode = nodeMap[otherId];
                    if (!otherNode) continue;
                    if (n._type && otherNode._type && n._type !== otherNode._type) continue;

                    var pair = n.id + '|' + otherId;
                    var pairRev = otherId + '|' + n.id;
                    if (existingPairs[pair] || existingPairs[pairRev]) continue;

                    if (!scoreMap[otherId]) {
                        scoreMap[otherId] = { score: 0, commonWords: [] };
                    }
                    scoreMap[otherId].score += idf;
                    if (scoreMap[otherId].commonWords.indexOf(word) < 0) {
                        scoreMap[otherId].commonWords.push(word);
                    }
                }
            }

            var scored = [];
            for (var oid in scoreMap) {
                if (Object.prototype.hasOwnProperty.call(scoreMap, oid)) {
                    scored.push({ id: oid, score: scoreMap[oid].score, commonWords: scoreMap[oid].commonWords });
                }
            }
            scored.sort(function (a, b) { return b.score - a.score; });

            var limit = Math.min(SCAN_CFG.topN, scored.length);
            for (var si2 = 0; si2 < limit; si2++) {
                var item = scored[si2];
                var pair2 = n.id + '|' + item.id;
                var pairRev2 = item.id + '|' + n.id;
                if (existingPairs[pair2] || existingPairs[pairRev2]) continue;

                newEdges.push({
                    source: n.id,
                    target: item.id,
                    label: item.commonWords.length > 0
                        ? '共同词: ' + item.commonWords.slice(0, 5).join('、')
                        : '关联'
                });
                existingPairs[pair2] = true;
                existingPairs[pairRev2] = true;
            }
        }

        return newEdges;
    };

    /**
     * 关系检测（用于生长线实时构建，保留用于兼容性）
     */
    App.prototype._detectRelationForGrowth = function (nodeA, nodeB) {
        var rawTagsA = nodeA._tags || [];
        var rawTagsB = nodeB._tags || [];
        if (!Array.isArray(rawTagsA)) rawTagsA = typeof rawTagsA === 'string' ? rawTagsA.split(',') : [];
        if (!Array.isArray(rawTagsB)) rawTagsB = typeof rawTagsB === 'string' ? rawTagsB.split(',') : [];
        var tagsA = rawTagsA.map(function (t) { return String(t).trim(); }).filter(function (t) { return t; });
        var tagsB = rawTagsB.map(function (t) { return String(t).trim(); }).filter(function (t) { return t; });

        var commonTags = [];
        for (var ti = 0; ti < tagsA.length; ti++) {
            for (var tj = 0; tj < tagsB.length; tj++) {
                if (tagsA[ti] === tagsB[tj]) {
                    commonTags.push(tagsA[ti]);
                    break;
                }
            }
        }
        if (commonTags.length > 0) {
            return '共同标签: ' + commonTags.join(', ');
        }

        var descA = (nodeA._desc || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ');
        var descB = (nodeB._desc || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ');
        var segsA = descA.split(/\s+/).filter(function (w) { return w.length >= 2; });
        var segsB = descB.split(/\s+/).filter(function (w) { return w.length >= 2; });
        var common = segsA.filter(function (w) { return segsB.indexOf(w) >= 0; });
        if (common.length >= 2) {
            return '描述相关: ' + common.slice(0, 3).join('、');
        }
        if (common.length === 1 && common[0].length >= 3) {
            return '描述相关: ' + common[0];
        }
        return null;
    };

    App.prototype._loadOrInitData = function () {
        var saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                var data = JSON.parse(saved);
                this.store.state.nodes = data.nodes || [];
                this.store.state.edges = data.edges || [];
                // 重建 parent/child 引用
                this._rebuildReferences();
                // 如果有节点，聚焦到第一个
                if (this.store.state.nodes.length > 0) {
                    this.camera.focusNode(this.store.state.nodes[0], 1);
                    this.camera.snapToTarget();
                }
                return;
            } catch (e) {
                console.error('加载数据失败', e);
            }
        }
        // 创建默认「原点」节点
        var origin = createNode('原点', -DEFAULT_NODE_WIDTH / 2, -DEFAULT_NODE_HEIGHT / 2);
        origin.color = NODE_COLOR_PRESETS[0];
        this.store.addNode(origin);
        this.camera.focusNode(origin, 1);
        this.camera.snapToTarget();
    };

    App.prototype._rebuildReferences = function () {
        var nodes = this.store.state.nodes;
        var edges = this.store.state.edges;
        for (var i = 0; i < nodes.length; i++) {
            nodes[i].parentIds = [];
            nodes[i].childIds = [];
        }
        for (var j = 0; j < edges.length; j++) {
            var e = edges[j];
            var s = this.store.findNode(e.source);
            var t = this.store.findNode(e.target);
            if (s && t) {
                if (s.childIds.indexOf(e.target) < 0) s.childIds.push(e.target);
                if (t.parentIds.indexOf(e.source) < 0) t.parentIds.push(e.source);
            }
        }
    };

    App.prototype._onResize = function () {
        var wrap = document.getElementById('gg-canvas-wrap');
        var rect = wrap.getBoundingClientRect();
        this.renderer.resize(rect.width, rect.height);
    };

    App.prototype._loop = function () {
        var self = this;
        function frame(now) {
            var dt = (now - self.lastFrameTime) / 1000;
            self.lastFrameTime = now;

            // 限制帧率
            var interval = 1000 / self.store.state.targetFps;
            if (now - self.lastFrameTime + dt * 1000 < interval) {
                // 不跳过，简单实现
            }

            // 更新摄像机
            self.camera.update(dt);

            // 更新缩放显示
            if (self.zoomText) {
                self.zoomText.textContent = Math.round(self.camera.zoom * 100) + '%';
            }

            // 渲染
            self.renderer.render(now);

            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    };

    // ---- 交互回调 ----
    App.prototype._onNodeClick = function (node) {
        if (this.store.state.mode === 'edit') {
            this.edgeEditPanel.close();
            this.editPanel.open(node.id);
        }
    };

    App.prototype._onCanvasClick = function () {
        this.editPanel.close();
        this.edgeEditPanel.close();
    };

    App.prototype._onEdgeClick = function (edge) {
        // 关闭节点编辑面板，打开连线编辑面板
        this.editPanel.close();
        this.edgeEditPanel.open(edge.id);
    };

    App.prototype._onNodeDragStart = function (node) {
        // 拖拽开始时关闭面板
    };

    App.prototype._onNodeDragEnd = function (node) {
        // 自动保存
        this._saveData();
    };

    App.prototype._onZoomChange = function (zoom) {
        // 更新画布大小滑块
        var slider = document.getElementById('gg-canvas-scale');
        if (slider) slider.value = Math.min(2, Math.max(0.5, zoom));
    };

    App.prototype._onLinkComplete = function () {
        this._showHint('母子线已创建', 1500);
        this._saveData();
    };

    App.prototype._onLinkRejected = function (reason) {
        this._showHint(reason || '无法创建连线', 2500);
    };

    // ---- 数据持久化 ----
    App.prototype._saveData = function () {
        var data = {
            nodes: this.store.state.nodes,
            edges: this.store.state.edges
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.error('保存失败', e);
        }
    };

    // 监听 store 变化自动保存
    App.prototype._autoSave = function () {
        var self = this;
        this.store.subscribe(function () {
            self._saveData();
            // 刷新节点仓库状态（节点添加/删除后更新标记）
            if (self.nodeStore) self.nodeStore.refresh();
        });
    };

    // ---- 状态提示 ----
    App.prototype._showHint = function (msg, duration) {
        if (!this.statusHint) return;
        this.statusHint.textContent = msg;
        this.statusHint.classList.add('show');
        if (this._hintTimer) clearTimeout(this._hintTimer);
        if (duration) {
            var self = this;
            this._hintTimer = setTimeout(function () {
                self.statusHint.classList.remove('show');
            }, duration);
        }
    };

    /* ========================================================
     * 启动
     * ======================================================== */
    document.addEventListener('DOMContentLoaded', function () {
        window._ggApp = new App();
    });

})();
