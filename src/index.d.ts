export interface DocsConfig {
  title: string;
  description?: string;
  icon?: string | { background?: string; color?: string; border?: string };
  tabs: Array<{ title: string; dir: string; slug: string }>;
}
export declare function defineConfig(config: DocsConfig): DocsConfig;
