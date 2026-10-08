export interface DocsConfig {
  title: string;
  description?: string;
  tabs: Array<{ title: string; dir: string; slug: string }>;
}
export declare function defineConfig(config: DocsConfig): DocsConfig;
