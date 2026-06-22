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

export type ApiRequestInit = RequestInit & {
  _timeout?: number;
  _timeoutMessage?: string;
};

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

  checkLoginStatus(init: ApiRequestInit = {}) {
    return this.request<LoginStatus>("/api/v1/login/status", init);
  }

  getLoginQrCode(init: ApiRequestInit = {}) {
    return this.request<LoginQrCode>("/api/v1/login/qrcode", init);
  }

  searchFeeds(payload: SearchRequest, init: ApiRequestInit = {}) {
    return this.request<SearchResponseData>("/api/v1/analysis/search", {
      ...init,
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  getFeedDetail(payload: FeedDetailRequest, init: ApiRequestInit = {}) {
    return this.request<FeedDetailData>("/api/v1/analysis/feed-detail", {
      ...init,
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  getUserProfile(payload: UserProfileRequest, init: ApiRequestInit = {}) {
    return this.request<UserProfileData>("/api/v1/user/profile", {
      ...init,
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  private async request<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
    const {
      _timeout,
      _timeoutMessage,
      signal: upstreamSignal,
      ...fetchInit
    } = init;
    const timeoutMs = _timeout ?? 60000;
    const controller = new AbortController();
    let abortReason: "timeout" | "upstream" | null = null;
    const abortFromUpstream = () => {
      abortReason = "upstream";
      controller.abort();
    };
    const timer = setTimeout(() => {
      abortReason = "timeout";
      controller.abort();
    }, timeoutMs);
    if (upstreamSignal?.aborted) {
      abortFromUpstream();
    } else {
      upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
    }

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...fetchInit,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...fetchInit.headers,
        },
      });

      clearTimeout(timer);

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
    } catch (error) {
      clearTimeout(timer);
      if ((error as Error).name === "AbortError") {
        if (abortReason === "upstream") {
          throw error;
        }
        if (_timeoutMessage) {
          throw new Error(_timeoutMessage);
        }
        throw new Error(`API 请求超时（${Math.round(timeoutMs / 1000)}s），MCP 采集服务可能卡住`);
      }
      throw error;
    } finally {
      upstreamSignal?.removeEventListener("abort", abortFromUpstream);
    }
  }
}

function trimTrailingSlash(url: string) {
  return url.replace(/\/+$/, "");
}

export const apiClient = new ApiClient();
