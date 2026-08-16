// 定义层 - 核心数据模型和常量定义

/**
 * 操作模式枚举
 */
const MODE = {
    TIMELINE: 'timeline',
    KNOWLEDGE: 'knowledge'
};

/**
 * 视频信息数据结构
 */
class ContentInfo {
    constructor(data = {}) {
        this.id = data.id || this.generateId();
        this.type = data.type || 'video'; // 'video' 或 'article'
        this.title = data.title || '';
        this.url = data.url || '';
        this.cover = data.cover || '';
        this.desc = data.desc || '';
        this.tags = data.tags || [];
        this.userTags = data.userTags || [];
        this.addDate = data.addDate || Date.now();
        this.updateDate = data.updateDate || Date.now();
    }

    generateId() {
        return `ks_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    validate() {
        const errors = [];
        
        if (!this.title.trim()) {
            errors.push('标题不能为空');
        }
        
        if (!this.url.trim()) {
            errors.push('链接不能为空');
        } else if (!this.isValidUrl(this.url)) {
            errors.push('链接格式不正确');
        }
        
        if (this.cover && !this.isValidUrl(this.cover)) {
            errors.push('封面图链接格式不正确');
        }
        
        return errors;
    }

    isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    }

    toObject() {
        return {
            id: this.id,
            type: this.type,
            title: this.title,
            url: this.url,
            cover: this.cover,
            desc: this.desc,
            tags: [...this.tags],
            userTags: [...this.userTags],
            addDate: this.addDate,
            updateDate: this.updateDate
        };
    }

    static fromObject(obj) {
        return new ContentInfo(obj);
    }
}

// 保持向后兼容
class VideoInfo extends ContentInfo {
    constructor(data = {}) {
        super({ ...data, type: 'video' });
    }
}

class ArticleInfo extends ContentInfo {
    constructor(data = {}) {
        super({ ...data, type: 'article' });
    }
}

/**
 * 搜索配置
 */
const SEARCH_CONFIG = {
    // FlexSearch 配置
    flexsearch: {
        tokenize: 'forward',
        resolution: 9,
        depth: 4,
        threshold: 0
    },
    // 搜索字段权重
    weights: {
        title: 2,
        desc: 1,
        tags: 1.5
    }
};

/**
 * 分页配置
 */
const PAGINATION_CONFIG = {
    timeline: {
        pageSize: 20,
        infiniteScroll: true
    },
    knowledge: {
        pageSize: 50, // 知识图谱模式一次性加载更多
        infiniteScroll: false
    }
};

/**
 * 本地身份系统接口（预留）
 */
class IdentitySystem {
    constructor() {
        this.isInitialized = false;
        this.keyPair = null;
        this.masterPassword = null;
    }

    /**
     * 初始化身份系统
     */
    async initialize(masterPassword) {
        // 预留实现：基于Web Crypto API的密钥对生成
        this.masterPassword = masterPassword;
        this.isInitialized = true;
        
        console.log('身份系统已初始化（预留功能）');
        return true;
    }

    /**
     * 加密数据（预留）
     */
    async encryptData(data) {
        if (!this.isInitialized) {
            throw new Error('身份系统未初始化');
        }
        // 预留实现
        return data;
    }

    /**
     * 解密数据（预留）
     */
    async decryptData(encryptedData) {
        if (!this.isInitialized) {
            throw new Error('身份系统未初始化');
        }
        // 预留实现
        return encryptedData;
    }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MODE, VideoInfo, SEARCH_CONFIG, PAGINATION_CONFIG, IdentitySystem };
}