const axios = require('axios');
const qs = require('querystring');
const https = require('https');

class Service115 {
    constructor() {
        this.agent = new https.Agent({ keepAlive: true });
        // 模拟微信小程序环境，目前相对稳定
        this.headers = {
            "Host": "webapi.115.com",
            "Connection": "keep-alive",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36 MicroMessenger/6.8.0(0x16080000) NetType/WIFI MiniProgramEnv/Mac MacWechat/WMPF XWEB/30626",
            "Referer": "https://servicewechat.com/wx2c744c010a61b0fa/94/page-frame.html",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept": "*/*"
        };
    }

    _getHeaders(cookie) {
        return { ...this.headers, "Cookie": cookie };
    }

    // 1. 获取用户信息
    async getUserInfo(cookie) {
        if (!cookie) throw new Error("Cookie为空");
        try {
            const res = await axios.get("https://webapi.115.com/files/index_info", {
                headers: this._getHeaders(cookie),
                httpsAgent: this.agent,
                timeout: 6000
            });
            if (res.data.state) {
                return { success: true, name: res.data.data?.user_name || "115用户" };
            }
            throw new Error("Cookie无效或已过期");
        } catch (e) {
            throw new Error("连接115失败: " + (e.response?.status || e.message));
        }
    }

    // 2. 获取文件夹列表
    async getFolderList(cookie, cid = "0") {
        try {
            const res = await axios.get("https://webapi.115.com/files", {
                headers: this._getHeaders(cookie),
                httpsAgent: this.agent,
                params: { aid: 1, cid: cid, o: "user_ptime", asc: 0, offset: 0, show_dir: 1, limit: 100, type: 0, format: "json" }
            });
            if (res.data.state) {
                return {
                    success: true,
                    path: res.data.path,
                    list: res.data.data.filter(item => item.cid).map(i => ({ cid: i.cid, name: i.n }))
                };
            }
            throw new Error(res.data.error || "获取目录失败");
        } catch (e) {
            throw new Error(e.message);
        }
    }

    // 3. 创建文件夹
    async addFolder(cookie, parentCid, folderName) {
        const postData = qs.stringify({
            pid: parentCid,
            cname: folderName
        });
        try {
            const res = await axios.post("https://webapi.115.com/files/add", postData, {
                headers: this._getHeaders(cookie),
                httpsAgent: this.agent
            });
            
            if (res.data.state) {
                return { success: true, cid: res.data.data.cid, name: res.data.data.file_name };
            }
            throw new Error(res.data.error || "创建文件夹失败");
        } catch (e) {
            throw new Error("创建文件夹API异常: " + e.message);
        }
    }

    // 4. 获取分享链接信息 (文件ID列表和标题)
    async getShareInfo(cookie, shareCode, receiveCode) {
        try {
            const res = await axios.get("https://webapi.115.com/share/snap", {
                headers: this._getHeaders(cookie),
                httpsAgent: this.agent,
                timeout: 10000,
                params: { share_code: shareCode, receive_code: receiveCode, offset: 0, limit: 100, cid: "" }
            });
            
            if (!res.data.state) {
                throw new Error(res.data.error || res.data.msg || "链接无效或提取码错误");
            }
            
            // 【关键修改】获取文件ID列表并排序，用于 server.js 中的哈希对比
            const fileIds = res.data.data.list
                .map(item => item.cid || item.fid)
                .sort(); 
                
            return {
                success: true,
                fileIds: fileIds,
                shareTitle: res.data.data.share_title || (res.data.data.list[0] ? res.data.data.list[0].n : "未命名任务"),
                count: res.data.data.count
            };
        } catch (e) {
            throw new Error(e.message);
        }
    }

    // 5. 转存文件
    async saveFiles(cookie, targetCid, shareCode, receiveCode, fileIds) {
        if (!fileIds.length) return { success: true, count: 0 }; // 没有文件要转存也算成功
        
        const postData = qs.stringify({
            cid: targetCid,
            share_code: shareCode,
            receive_code: receiveCode,
            file_id: fileIds.join(',')
        });

        try {
            const res = await axios.post("https://webapi.115.com/share/receive", postData, {
                headers: this._getHeaders(cookie),
                httpsAgent: this.agent
            });
            if (res.data.state) return { success: true, count: fileIds.length };
            return { success: false, msg: res.data.error || res.data.msg || "转存被拒绝" };
        } catch (e) {
            return { success: false, msg: "转存API请求失败: " + e.message };
        }
    }
}

module.exports = new Service115();
