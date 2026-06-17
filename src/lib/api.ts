import type {
  ApiErrorPayload,
  ApiResponse,
  FeedDetailData,
  FeedDetailRequest,
  LoginQrCode,
  LoginStatus,
  SearchRequest,
  SearchResponseData,
  UserProfileData,
  UserProfileRequest,
} from "../types";

const DEFAULT_BASE_URL = import.meta.env.VITE_XHS_MCP_BASE_URL || "http://127.0.0.1:18060";

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl = DEFAULT_BASE_URL) {
    this.baseUrl = trimTrailingSlash(baseUrl);
  }

  setBaseUrl(baseUrl: string) {
    this.baseUrl = trimTrailingSlash(baseUrl);
  }

  getBaseUrl() {
    return this.baseUrl;
  }

  checkLoginStatus() {
    return this.request<LoginStatus>("/api/v1/login/status");
  }

  getLoginQrCode() {
    return this.request<LoginQrCode>("/api/v1/login/qrcode");
  }

  searchFeeds(payload: SearchRequest) {
    return this.request<SearchResponseData>("/api/v1/analysis/search", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  getFeedDetail(payload: FeedDetailRequest) {
    return this.request<FeedDetailData>("/api/v1/analysis/feed-detail", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  getUserProfile(payload: UserProfileRequest) {
    return this.request<UserProfileData>("/api/v1/user/profile", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init.headers,
      },
    });

    const payload = (await response.json().catch(() => null)) as
      | ApiResponse<T>
      | ApiErrorPayload
      | null;

    if (!response.ok || !payload) {
      throw new Error(`HTTP ${response.status}: ${response.statusText || "请求失败"}`);
    }

    if ("success" in payload && payload.success) {
      return payload.data;
    }

    if ("error" in payload) {
      throw new Error(payload.details ? `${payload.error}: ${String(payload.details)}` : payload.error);
    }

    throw new Error("接口返回格式不符合预期");
  }
}

function trimTrailingSlash(url: string) {
  return url.replace(/\/+$/, "");
}

export const apiClient = new ApiClient();
