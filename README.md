# XHS Insight React 采集工作台

基于 `product-prototype` 原型开发的 React 前端，用于调用 `xiaohongshu-mcp` HTTP API 完成小红书关键词采集、任务队列、帖子详情、评论和用户资料展示。

## 启动

```bash
npm install
npm run dev
```

默认 MCP 地址是：

```text
http://127.0.0.1:18060
```

页面左侧可以直接修改 Base URL。

## 已实现范围

- 检查登录状态
- 获取扫码登录二维码
- 输入关键词和筛选条件创建采集任务
- 调用 `search_feeds` 搜索帖子
- 过滤 `modelType !== "note"` 的数据
- 小并发逐条调用 `get_feed_detail`
- 可选加载评论、二级评论和用户主页
- 展示采集进度、任务队列、帖子、评论、用户资料
- 本地缓存采集结果，后续可替换为服务端 PostgreSQL 写入
- 预留 PostgreSQL 建表 SQL：`docs/postgres-schema.sql`

## 数据库存储边界

浏览器前端不建议直接连接 PostgreSQL。正式接入 `xhs_data_collect` 时，建议新增一个后端存储 API，由后端写入 PostgreSQL，前端继续调用采集 API 和存储 API。
