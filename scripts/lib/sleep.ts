/** 指定ミリ秒待つ。テストでは各関数の `wait` オプションで差し替える */
export const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
