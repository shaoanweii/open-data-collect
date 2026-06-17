import { Loader2, Search } from "lucide-react";
import { FilterGroup, NumberField } from "../../components/page-shared";
import type {
  CollectOptions,
  LocationFilter,
  NoteType,
  PublishTime,
  SearchFilters,
  SearchScope,
  SortBy,
} from "../../types";

const channelGroups = [
  { label: "社交媒体", items: ["抖音", "小红书"] },
  { label: "汽车垂媒", items: ["汽车之家", "懂车帝", "易车网"] },
];

export function CollectPage({
  keyword,
  channel,
  filters,
  options,
  isRunning,
  onKeywordChange,
  onChannelChange,
  onCreateTask,
  onUpdateFilter,
  onUpdateOption,
  onUpdateCommentConfig,
}: {
  keyword: string;
  channel: string;
  filters: SearchFilters;
  options: CollectOptions;
  isRunning: boolean;
  onKeywordChange: (value: string) => void;
  onChannelChange: (value: string) => void;
  onCreateTask: () => void;
  onUpdateFilter: <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => void;
  onUpdateOption: (patch: Partial<CollectOptions>) => void;
  onUpdateCommentConfig: (patch: Partial<CollectOptions["commentConfig"]>) => void;
}) {
  return (
    <section className="workspace single-column">
      <div className="panel glass collect-config-panel">
        <div className="panel-heading">
          <div>
            <h3>采集配置</h3>
            <p>选择采集渠道并输入搜索关键词。</p>
          </div>
        </div>

        <fieldset className="filter-group">
          <legend>采集渠道</legend>
          <div className="channel-group-list">
            {channelGroups.map((group) => (
              <div className="channel-group" key={group.label}>
                <span>{group.label}</span>
                <div className="choice-row">
                  {group.items.map((ch) => (
                    <button
                      className={`choice ${channel === ch ? "active" : ""}`}
                      key={ch}
                      type="button"
                      onClick={() => onChannelChange(ch)}
                    >
                      {ch}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span>关键词</span>
          <textarea
            className="keyword-input"
            value={keyword}
            onChange={(event) => onKeywordChange(event.target.value)}
            placeholder="输入品牌、车型、话题或场景词"
          />
        </label>
      </div>

      <div className="collect-right">
        <div className="panel glass">
          <div className="panel-heading">
            <div>
              <h3>采集条件</h3>
              <p>筛选帖子类型、时间和排序方式。</p>
            </div>
          </div>

          <div className="filter-grid">
            <FilterGroup<LocationFilter>
              title="位置"
              value={filters.location}
              items={["不限", "同城", "附近"]}
              onChange={(value) => onUpdateFilter("location", value)}
            />
            <FilterGroup<NoteType>
              title="帖子类型"
              value={filters.note_type}
              items={["不限", "图文", "视频"]}
              tone="blue"
              onChange={(value) => onUpdateFilter("note_type", value)}
            />
            <FilterGroup<PublishTime>
              title="发布时间"
              value={filters.publish_time}
              items={["不限", "一天内", "一周内", "半年内"]}
              tone="gold"
              onChange={(value) => onUpdateFilter("publish_time", value)}
            />
            <FilterGroup<SearchScope>
              title="搜索范围"
              value={filters.search_scope}
              items={["不限", "已看过", "未看过", "已关注"]}
              tone="rose"
              onChange={(value) => onUpdateFilter("search_scope", value)}
            />
            <FilterGroup<SortBy>
              title="排序方式"
              value={filters.sort_by}
              items={["综合", "最新", "最多点赞", "最多评论", "最多收藏"]}
              className="wide-filter"
              onChange={(value) => onUpdateFilter("sort_by", value)}
            />
          </div>

          <div className="option-grid">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={options.commentConfig.click_more_replies}
                onChange={(event) => onUpdateCommentConfig({ click_more_replies: event.target.checked })}
              />
              <span>展开二级评论</span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={options.includeUserProfiles}
                onChange={(event) => onUpdateOption({ includeUserProfiles: event.target.checked })}
              />
              <span>补充用户主页</span>
            </label>
          </div>

          <div className="number-grid">
            <NumberField
              label="主贴返回数量"
              hint="不填默认查询全部相关主贴"
              value={options.searchLimit}
              min={1}
              max={500}
              onChange={(value) => onUpdateOption({ searchLimit: value })}
              optional
            />
            <NumberField
              label="一级评论上限"
              hint="默认采集前10条评论"
              value={options.commentConfig.max_comment_items}
              min={10}
              max={100}
              onChange={(value) => onUpdateCommentConfig({ max_comment_items: value ?? 10 })}
            />
            <NumberField
              label="并发数"
              value={1}
              min={1}
              max={1}
              onChange={() => onUpdateOption({ maxDetailConcurrency: 1 })}
            />
            <NumberField
              label="请求间隔 ms"
              value={options.requestDelayMs}
              min={0}
              max={5000}
              step={500}
              onChange={(value) => onUpdateOption({ requestDelayMs: value ?? 1500 })}
            />
          </div>
        </div>

        <button className="primary-action" type="button" onClick={onCreateTask} disabled={isRunning}>
          {isRunning ? <Loader2 className="spin" size={18} /> : <Search size={18} />}
          创建采集任务
        </button>
      </div>
    </section>
  );
}
