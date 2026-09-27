export const TORITSU_API_BASE = 'https://ai-api.metro.tokyo.lg.jp';
export const TORITSU_API_PATH = '/api/v1/public/message';

export function isToritsuPublicApi(config: { baseUrl: string; chatEndpoint: string }): boolean {
  return config.baseUrl.trim().replace(/\/+$/, '') === TORITSU_API_BASE &&
    config.chatEndpoint.trim() === TORITSU_API_PATH;
}
