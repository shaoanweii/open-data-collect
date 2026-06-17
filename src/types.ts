export type SortBy = "综合" | "最新" | "最多点赞" | "最多评论" | "最多收藏";
export type NoteType = "不限" | "视频" | "图文";
export type PublishTime = "不限" | "一天内" | "一周内" | "半年内";
export type SearchScope = "不限" | "已看过" | "未看过" | "已关注";
export type LocationFilter = "不限" | "同城" | "附近";
export type ScrollSpeed = "slow" | "normal" | "fast";

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "paused";
export type ItemStatus = "queued" | "fetching" | "completed" | "failed" | "skipped";

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface ApiErrorPayload {
  error: string;
  code?: string;
  details?: unknown;
}

export interface LoginStatus {
  is_logged_in: boolean;
}

export interface LoginQrCode {
  qr_code?: string;
}

export interface SearchFilters {
  sortBy?: SortBy;
  noteType?: NoteType;
  publishTime?: PublishTime;
  searchScope?: SearchScope;
  location?: LocationFilter;
}

export interface SearchRequest {
  keyword: string;
  filters?: SearchFilters;
  limit?: number;
}

export interface CommentConfig {
  enable_comment_collect: boolean;
  max_comments_per_post: number;
  include_sub_comments: boolean;
  max_sub_comments_per_comment: number;
}

export interface FeedDetailRequest {
  feed_id: string;
  xsec_token: string;
}

export interface UserProfileRequest {
  userId: string;
  xsec_token: string;
}

export interface FeedCardUser {
  userId?: string;
  xsecToken?: string;
  xsec_token?: string;
  nickname?: string;
  avatar?: string;
  redId?: string;
  verified?: boolean;
}

export interface FeedCardInteractInfo {
  likedCount?: string;
  collectedCount?: string;
  commentCount?: string;
  sharedCount?: string;
}

export interface FeedCardCover {
  url?: string;
  type?: string;
  width?: number;
  height?: number;
}

export interface SearchFeedItem {
  id?: string;
  xsecToken?: string;
  xsec_token?: string;
  modelType?: string;
  noteType?: string;
  noteCard?: {
    displayTitle?: string;
    title?: string;
    desc?: string;
    user?: FeedCardUser;
    interactInfo?: FeedCardInteractInfo;
    cover?: FeedCardCover;
  };
}

export interface SearchResponseData {
  success?: boolean;
  feeds?: SearchFeedItem[];
  total?: number;
}

export interface NoteDetail {
  noteId?: string;
  title?: string;
  desc?: string;
  type?: string;
  time?: number;
  user?: FeedCardUser;
  interactInfo?: FeedCardInteractInfo;
  ipLocation?: string;
  tagList?: Array<{ id: string; name: string }>;
  imageList?: Array<{ url: string }>;
}

export interface CommentUserInfo {
  userId?: string;
  xsecToken?: string;
  xsec_token?: string;
  nickname?: string;
  avatar?: string;
}

export interface SubComment {
  id?: string;
  content?: string;
  userInfo?: CommentUserInfo;
  ipLocation?: string;
  createTime?: number;
}

export interface FeedComment {
  id?: string;
  content?: string;
  userInfo?: CommentUserInfo;
  ipLocation?: string;
  createTime?: number;
  subComments?: SubComment[];
}

export interface FeedDetailData {
  feed_id?: string;
  success?: boolean;
  data?: {
    note?: NoteDetail;
    comments?: {
      list?: FeedComment[];
      bottomHasMore?: boolean;
      total?: number;
    };
  };
}

export interface UserProfileData {
  success?: boolean;
  data?: {
    user?: {
      userId?: string;
      nickname?: string;
      redId?: string;
      gender?: number;
      ipLocation?: string;
      desc?: string;
      avatar?: string;
      fans?: string | number;
      follows?: string | number;
      interactions?: Array<{ type?: string; name?: string; count?: string | number }>;
      likedAndCollectedCount?: string | number;
    };
  };
}

export interface CollectOptions {
  searchLimit: number;
  maxComments: number;
  commentOrder: "hot" | "time";
  scrollSpeed: ScrollSpeed;
  includeSubComments: boolean;
  includeUserProfiles: boolean;
  commentConfig: CommentConfig;
}

export interface QueueItem {
  feedId: string;
  xsecToken: string;
  title: string;
  authorId?: string;
  authorName?: string;
  searchItem: SearchFeedItem;
  status: "queued" | "fetching" | "completed" | "failed" | "skipped";
  error?: string;
}

export interface TaskLog {
  id: string;
  time: string;
  type: "task" | "search" | "request" | "response" | "error" | "debug";
  title: string;
  message: string;
  payload?: unknown;
}

export interface CollectionTask {
  id: string;
  keyword: string;
  channel: string;
  filters: SearchFilters;
  options: CollectOptions;
  status: "queued" | "running" | "completed" | "failed" | "paused";
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  total: number;
  completed: number;
  failed: number;
  message: string;
  items: QueueItem[];
  errors: Array<{ time: string; message: string }>;
  logs: TaskLog[];
}

export interface StoredPost {
  taskId: string;
  feedId: string;
  title?: string;
  desc?: string;
  authorId?: string;
  authorName?: string;
  authorAvatar?: string;
  likedCount?: string;
  sharedCount?: string;
  commentCount?: string;
  collectedCount?: string;
  ipLocation?: string;
  publishTime?: number;
  rawPayload: unknown;
}

export interface StoredComment {
  taskId: string;
  feedId: string;
  commentId: string;
  parentCommentId?: string;
  userId?: string;
  nickname?: string;
  avatar?: string;
  content?: string;
  ipLocation?: string;
  createTime?: number;
  likeCount?: string;
  xsecToken?: string;
  rawPayload: unknown;
}

export interface StoredUser {
  taskId: string;
  userId: string;
  nickname?: string;
  avatar?: string;
  redId?: string;
  ipLocation?: string;
  desc?: string;
  interactions?: Array<{
    type?: string;
    name?: string;
    count?: string | number;
  }>;
  fansCount?: string;
  followsCount?: string;
  likedAndCollectedCount?: string;
  rawPayload: unknown;
}

// 用户画像分析聚合数据
export interface AnalyticsData {
  channelTasks: Array<{ channel: string; count: number }>;
  channelPosts: Array<{ channel: string; count: number }>;
  channelComments: Array<{ channel: string; count: number }>;
  channelUsers: Array<{ channel: string; count: number }>;
  ipLocations: Array<{ ip_location: string; count: number }>;
}
